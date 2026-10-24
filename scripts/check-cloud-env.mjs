import fs from 'node:fs';
import { parse } from 'dotenv';

const root = process.cwd();
const cloudFile = `${root}/temp/cloud/cloud.env`;
const frontendFile = `${root}/.env.cloud.local`;
const cloud = fs.existsSync(cloudFile) ? parse(fs.readFileSync(cloudFile, 'utf8')) : {};
const frontend = fs.existsSync(frontendFile) ? parse(fs.readFileSync(frontendFile, 'utf8')) : {};
const get = (key) => process.env[key] || cloud[key] || '';
const url = get('SUPABASE_URL');
const anon = get('SUPABASE_ANON_KEY');
const service = get('SUPABASE_SERVICE_ROLE_KEY');
const db = get('SUPABASE_DB_URL');
const token = get('SUPABASE_ACCESS_TOKEN');
const ref = get('SUPABASE_PROJECT_REF');
let host = null;
try { host = url ? new URL(url).host : null; } catch { host = null; }
const frontendSecrets = Object.keys(frontend).filter((key) => /SERVICE_ROLE|DATABASE_URL|ACCESS_TOKEN|SECRET/i.test(key));
const report = {
  cloudFile: fs.existsSync(cloudFile),
  projectRef: Boolean(ref),
  projectHost: host,
  anonKeyPresent: Boolean(anon),
  serviceKeyPresent: Boolean(service),
  dbUrlPresent: Boolean(db),
  accessTokenPresent: Boolean(token),
  frontendFile: fs.existsSync(frontendFile),
  frontendHasServiceSecrets: frontendSecrets.length > 0,
  readyForReadOnlyInspection: Boolean((ref && token) || (url && db)),
  readyForDatabaseMigration: Boolean((token && ref) || db),
  readyForFrontendBuild: Boolean(frontend.VITE_SUPABASE_URL && frontend.VITE_SUPABASE_ANON_KEY),
};
console.log(JSON.stringify(report, null, 2));
if (!report.readyForReadOnlyInspection || frontendSecrets.length > 0) process.exitCode = 1;
