import fs from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Controlled administrator MFA recovery. This utility is intentionally not
// exposed to the browser and never changes passwords, roles or active flags.
const envFile = process.env.UPC_ENV_FILE || '.env.import.local';
const env = parse(fs.readFileSync(envFile, 'utf8'));
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const host = new URL(url).hostname;
const remoteAllowed = process.env.UPC_ALLOW_REMOTE_MFA_RECOVERY === '1';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) && !remoteAllowed) {
  throw new Error('Remote MFA recovery requires UPC_ALLOW_REMOTE_MFA_RECOVERY=1 and a change ticket.');
}

const args = process.argv.slice(2);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const userId = valueOf('--user-id');
const operator = valueOf('--operator');
const reason = valueOf('--reason');
const execute = args.includes('--execute');
const confirmed = args.includes('--confirm');

if (!userId || !operator || !reason) {
  console.error('Usage: node scripts/recover-admin-mfa.mjs --user-id <uuid> --operator <label> '
    + '--reason <20+ chars> [--execute --confirm]');
  process.exit(2);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  console.error('--user-id must be a UUID');
  process.exit(2);
}
if (reason.trim().length < 20) {
  console.error('--reason must contain at least 20 characters');
  process.exit(2);
}
if (operator.trim().length < 2) {
  console.error('--operator must contain at least 2 characters');
  process.exit(2);
}
if (execute && !confirmed) {
  console.error('Refusing recovery without --execute --confirm. Run the dry-run first.');
  process.exit(2);
}

async function run() {
const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

const [authBefore, adminRow] = await Promise.all([
  service.auth.admin.getUserById(userId),
  service.from('admin_users').select('role,is_active').eq('user_id', userId).maybeSingle(),
]);
if (authBefore.error || !authBefore.data?.user) throw new Error('Auth user not found');
if (adminRow.error) throw adminRow.error;
if (!adminRow.data) throw new Error('Target is not a registered administrator');
if (adminRow.data.is_active !== true) {
  console.error('Target administrator is inactive. Recovery is allowed, but access remains disabled.');
}
const factors = authBefore.data.user.factors || [];
const summary = {
  dryRun: !execute,
  environment: new URL(url).hostname,
  targetIsAdmin: true,
  adminRole: adminRow.data.role,
  adminActive: adminRow.data.is_active,
  factors: factors.map((factor) => ({
    id: factor.id, type: factor.factor_type, status: factor.status,
    friendlyName: factor.friendly_name || null,
  })),
};
if (!execute) {
  console.log(JSON.stringify({
    ...summary,
    next: factors.length
      ? 'Review the factors, verify identity out of band, then rerun with --execute --confirm.'
      : 'No MFA factors remain; no recovery is needed.',
  }, null, 2));
  return;
}
if (!factors.length) {
  console.error('No MFA factors to remove. Refusing to write a recovery audit record.');
  process.exitCode = 2;
  return;
}

const removed = [];
try {
  for (const factor of factors) {
    const response = await fetch(`${url}/auth/v1/admin/users/${userId}/factors/${factor.id}`, {
      method: 'DELETE', headers,
    });
    if (!response.ok) {
      throw new Error(`Auth Admin factor deletion failed for ${factor.id}: HTTP ${response.status}`);
    }
    removed.push(factor.id);
  }
} catch (error) {
  console.error(JSON.stringify({
    ...summary, removed, status: 'failed_before_audit',
    message: String(error.message || error),
    note: 'Some factors may already be removed; sessions were not revoked and no recovery audit was written.',
  }, null, 2));
  process.exitCode = 1;
  return;
}

let audit;
try {
  audit = await service.rpc('record_admin_mfa_recovery', {
    p_user_id: userId,
    p_operator: operator.trim(),
    p_reason: reason.trim(),
    p_factor_ids: removed,
  });
  if (audit.error || audit.data?.success !== true) {
    throw audit.error || new Error('recovery audit RPC returned no success');
  }
} catch (error) {
  console.error(JSON.stringify({
    ...summary, removed, status: 'factors_removed_audit_failed',
    message: String(error.message || error),
    note: 'Factors are gone but sessions/audit are incomplete. Do not treat recovery as finished; '
      + 'revoke sessions and append the audit through the database operator runbook before re-enrollment.',
  }, null, 2));
  process.exitCode = 1;
  return;
}

const after = await service.auth.admin.getUserById(userId);
const remainingFactors = after.data?.user?.factors?.length || 0;
if (after.error || remainingFactors !== 0) {
  console.error(JSON.stringify({
    ...summary, removed, status: 'verification_failed',
    remainingFactors, message: after.error?.message || 'MFA factors remain',
  }, null, 2));
  process.exitCode = 1;
  return;
}

console.log(JSON.stringify({
  ...summary,
  status: 'completed',
  removedFactorIds: removed,
  sessionsRevoked: audit.data.sessions_revoked,
  role: audit.data.role,
  active: audit.data.active,
  next: 'The administrator must sign in again with the existing password, enroll a new TOTP factor, '
    + 'verify AAL2, and confirm the audit entry. No password or role was changed.',
}, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
