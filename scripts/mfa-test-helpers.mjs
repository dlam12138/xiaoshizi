import fs from 'node:fs';
import { createHmac } from 'node:crypto';

function decodeBase32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotp(secret, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function readTotpSecret(envFile) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
  const found = lines.find((line) => line.startsWith('TEST_ADMIN_TOTP_SECRET='));
  if (!found) return null;
  try { return JSON.parse(found.slice('TEST_ADMIN_TOTP_SECRET='.length)); } catch { return found.split('=', 2)[1] || null; }
}

export function writeTotpSecret(envFile, secret) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
  const next = lines.filter((line) => line && !line.startsWith('TEST_ADMIN_TOTP_SECRET='));
  next.push(`TEST_ADMIN_TOTP_SECRET=${JSON.stringify(secret)}`);
  fs.writeFileSync(envFile, `${next.join('\n')}\n`, { mode: 0o600 });
}

export async function ensureAdminAal2(client, envFile = '.env.test.local') {
  const factors = await client.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const verified = (factors.data?.totp || []).find((factor) => factor.status === 'verified');
  let factorId = verified?.id;
  let secret = readTotpSecret(envFile);

  if (!factorId) {
    for (const factor of factors.data?.all || factors.data?.totp || []) {
      if (factor.status !== 'verified') {
        await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {});
      }
    }
    const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'security-verification' });
    if (enrolled.error) throw enrolled.error;
    factorId = enrolled.data.id;
    secret = enrolled.data.totp.secret;
    writeTotpSecret(envFile, secret);
  }
  if (!secret) throw new Error('A verified TOTP factor exists but TEST_ADMIN_TOTP_SECRET is unavailable.');

  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verifiedSession = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: generateTotp(secret),
  });
  if (verifiedSession.error) throw verifiedSession.error;
  return { factorId, secretStored: true };
}
