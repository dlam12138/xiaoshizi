import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

// No email is sent by this script. Domain setup and SMTP changes are separate.
const root = fileURLToPath(new URL('../', import.meta.url));
const privateDir = path.join(root, 'temp/cloud');
const envFile = path.join(privateDir, 'cloud.env');
const env = fs.existsSync(envFile) ? parse(fs.readFileSync(envFile, 'utf8')) : {};
const get = (name) => process.env[name] || env[name] || '';
const domainName = get('RESEND_DOMAIN');
const projectRef = get('SUPABASE_PROJECT_REF');
const zoneName = get('DNS_ZONE');
const action = process.argv[2] || 'plan';
const setupKey = get('RESEND_SETUP_API_KEY');
const sendingKey = get('RESEND_API_KEY');
const token = get('SUPABASE_ACCESS_TOKEN');

function save(name, data) {
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(path.join(privateDir, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

async function request(origin, endpoint, key, method = 'GET', body) {
  const response = await fetch(origin + endpoint, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  // Do not print API response bodies: Auth configuration may contain secrets.
  if (!response.ok) throw new Error(`${new URL(origin).hostname} ${method} ${endpoint}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const resend = (endpoint, method, body) => request('https://api.resend.com', endpoint, setupKey, method, body);
const auth = (method, body) => request('https://api.supabase.com', `/v1/projects/${projectRef}/config/auth`, token, method, body);

async function findDomain() {
  let cursor = '';
  do {
    const page = await resend(`/domains?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
    const match = page.data?.find((item) => item.name === domainName);
    if (match) return resend(`/domains/${encodeURIComponent(match.id)}`);
    const next = page.has_more ? page.data?.at(-1)?.id : '';
    if (next && next === cursor) throw new Error('Domain pagination did not advance.');
    cursor = next;
  } while (cursor);
  return null;
}

async function main() {
  if (!['plan', 'domain', 'smtp'].includes(action)) throw new Error('Usage: node scripts/setup-resend.mjs [plan|domain|smtp]');
  if (action === 'plan') {
    console.log(JSON.stringify({ domain: domainName, projectRef, setupKeyPresent: Boolean(setupKey), sendingKeyPresent: Boolean(sendingKey), supabaseTokenPresent: Boolean(token), testEmailSent: false }));
    return;
  }
  if (!domainName || !projectRef || !zoneName) {
    throw new Error('Set RESEND_DOMAIN, SUPABASE_PROJECT_REF and DNS_ZONE for your own deployment.');
  }
  if (domainName !== `auth.${zoneName}`) {
    throw new Error('RESEND_DOMAIN must be the auth subdomain of DNS_ZONE.');
  }
  if (!setupKey) throw new Error('Save RESEND_SETUP_API_KEY in temp/cloud/cloud.env first (Full access, setup only).');
  let domain = await findDomain();
  if (action === 'domain') {
    if (!domain) domain = await resend('/domains', 'POST', { name: domainName, region: 'ap-northeast-1', capabilities: { sending: 'enabled', receiving: 'disabled' } });
    await resend(`/domains/${encodeURIComponent(domain.id)}`, 'PATCH', { click_tracking: false, open_tracking: false });
    domain = await resend(`/domains/${encodeURIComponent(domain.id)}`);
    save('resend-domain.json', domain);
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['purpose', 'type', 'aliyun_host', 'value', 'priority', 'ttl', 'status'], ...(domain.records || []).map((r) => {
      const rawName = r.name.replace(/\.$/, '');
      const host = rawName.endsWith(`.${zoneName}`) ? rawName.slice(0, -`.${zoneName}`.length) : rawName;
      if (host !== 'auth' && !host.endsWith('.auth')) throw new Error('DNS record is outside the intended auth subdomain.');
      return [r.record, r.type, host, r.value, r.priority, 600, r.status];
    })];
    fs.writeFileSync(path.join(privateDir, 'resend-dns-records.csv'), '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\n') + '\n');
    if (domain.status !== 'verified') await resend(`/domains/${encodeURIComponent(domain.id)}/verify`, 'POST');
    console.log(JSON.stringify({ domain: domainName, status: domain.status, dnsRecords: 'temp/cloud/resend-dns-records.csv', trackingDisabled: domain.click_tracking === false && domain.open_tracking === false, dnsChanged: false, testEmailSent: false }));
    return;
  }
  if (!domain || domain.status !== 'verified') throw new Error('Domain is not verified; SMTP was not changed.');
  if (domain.click_tracking !== false || domain.open_tracking !== false) throw new Error('Disable domain tracking first with the domain action.');
  if (!sendingKey || sendingKey === setupKey) throw new Error('Provide a separate domain-restricted Sending access key as RESEND_API_KEY.');
  if (!token) throw new Error('Missing SUPABASE_ACCESS_TOKEN.');
  const config = await auth('GET');
  if (config.smtp_host && config.smtp_host !== 'smtp.resend.com') throw new Error('Existing non-Resend SMTP provider found; review before replacing.');
  const desired = { smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend', smtp_pass: sendingKey, smtp_admin_email: `noreply@${domainName}`, smtp_sender_name: '小石子' };
  const snapshotFile = path.join(privateDir, 'resend-smtp-before.json');
  if (!fs.existsSync(snapshotFile)) save('resend-smtp-before.json', { capturedAt: new Date().toISOString(), projectRef, previous: Object.fromEntries(Object.keys(desired).map((key) => [key, config[key] ?? null])), note: 'API may mask smtp_pass; restoring a previous provider requires its original credential.' });
  await auth('PATCH', desired);
  const after = await auth('GET');
  for (const [key, value] of Object.entries(desired)) {
    if (key !== 'smtp_pass' && String(after[key]) !== String(value)) throw new Error(`SMTP read-back mismatch: ${key}`);
  }
  for (const key of ['site_url', 'uri_allow_list', 'mailer_autoconfirm', 'mailer_secure_email_change_enabled']) {
    if (after[key] !== config[key]) throw new Error(`Unrelated Auth setting changed: ${key}`);
  }
  const evidence = { checkedAt: new Date().toISOString(), projectRef, domain: domainName, smtpHost: after.smtp_host, smtpPort: after.smtp_port, sender: after.smtp_admin_email, settingsReadBack: true, authUrlsChanged: false, testEmailSent: false, deliveryVerified: false };
  save('resend-smtp-configured.json', evidence);
  console.log(JSON.stringify(evidence));
}

main().catch((error) => { console.error(`[resend-setup] ${error.message}`); process.exitCode = 1; });
