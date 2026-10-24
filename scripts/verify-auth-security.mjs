import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const publicEnv = parse(fs.readFileSync('.env.local', 'utf8'));
const serviceEnv = parse(fs.readFileSync('.env.import.local', 'utf8'));
const url = publicEnv.VITE_SUPABASE_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('This verification is restricted to the local loopback Supabase stack.');
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
const service = createClient(url, serviceEnv.SUPABASE_SERVICE_ROLE_KEY, options);
const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const studentEmail = `security-check-${stamp}@s.upc.edu.cn`;
const aliasEmail = `security-check-${stamp}+alias@s.upc.edu.cn`;
const password = `Upc-${randomBytes(18).toString('hex')}!`;
const passed = [];
const report = { testedAt: new Date().toISOString(), environment: 'local-native-supabase', passed, cleanup: null };
let createdUserId = null;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed.push(label);
};
const nonStudentEmails = [
  `security-check-${stamp}@example.test`,
  `security-check-${stamp}@upc.edu.cn`,
  `security-check-${stamp}@s.upc.edu.cn.evil.test`,
];

try {
  for (const email of nonStudentEmails) {
    const result = await anon.auth.signUp({ email, password });
    check(Boolean(result.error), `real Auth hook rejects non-student domain ${email.split('@')[1]}`);
    check(!result.data?.user, `no user is created for ${email.split('@')[1]}`);
  }

  const signup = await anon.auth.signUp({ email: studentEmail, password });
  if (signup.error) throw signup.error;
  createdUserId = signup.data.user?.id || null;
  check(Boolean(createdUserId), 'real Auth hook allows exact student domain');
  check(!signup.data.session, 'email confirmation is still required before login');

  const confirmed = await service.auth.admin.updateUserById(createdUserId, { email_confirm: true });
  if (confirmed.error) throw confirmed.error;
  check(Boolean(confirmed.data.user.email_confirmed_at), 'synthetic student account is confirmed through admin test setup');

  const sessionClient = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
  const signed = await sessionClient.auth.signInWithPassword({ email: studentEmail, password });
  if (signed.error) throw signed.error;
  check(Boolean(signed.data.user), 'confirmed student can sign in with the public key');

  const blockedChange = await sessionClient.auth.updateUser({
    email: `security-check-${stamp}@example.test`,
  });
  check(Boolean(blockedChange.error), 'direct auth.updateUser to a non-student email is rejected');
  const afterBlocked = await service.auth.admin.getUserById(createdUserId);
  check(afterBlocked.data.user.email === studentEmail, 'blocked email change leaves auth.users.email unchanged');

  const allowedChange = await sessionClient.auth.updateUser({ email: aliasEmail });
  check(!allowedChange.error, 'student-to-student alias change is accepted for confirmation');
  const afterAllowed = await service.auth.admin.getUserById(createdUserId);
  const pendingChange = String(afterAllowed.data.user.new_email || '');
  check(
    afterAllowed.data.user.email === studentEmail && pendingChange.toLowerCase() === aliasEmail,
    'student alias change remains pending confirmation and does not replace the current email',
  );

  report.cleanup = 'synthetic auth user and profile removed';
} finally {
  if (createdUserId) {
    await service.from('user_profiles').delete().eq('id', createdUserId);
    const deleted = await service.auth.admin.deleteUser(createdUserId);
    report.cleanup = deleted.error ? `cleanup_error:${deleted.error.message}` : 'deleted';
  }
}

const outDir = path.join('temp', 'supabase-local');
fs.mkdirSync(outDir, { recursive: true });
report.cleanupSucceeded = report.cleanup === 'deleted';
fs.writeFileSync(path.join(outDir, 'auth-security-report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'auth-security-report.md'), [
  '# 真实 Auth 安全验证',
  '',
  `- 时间：${report.testedAt}`,
  `- 环境：${report.environment}`,
  `- 结果：${report.cleanupSucceeded ? '通过' : '有清理问题'}`,
  '',
  ...passed.map((item) => `- [x] ${item}`),
  '',
].join('\n'));
console.log(`${passed.length} real Auth security checks passed.`);
