#!/usr/bin/env node
/**
 * Validate the local UPC test-project configuration without printing secrets.
 *
 * Usage:
 *   node scripts/check-supabase-env.mjs
 *   node scripts/check-supabase-env.mjs --remote
 *   node scripts/check-supabase-env.mjs --remote --strict
 *
 * The script reads .env.local and .env.import.local from the repository root.
 * It never writes these files and never prints a key. It also refuses to treat
 * a service_role key as a user session; remote checks use it only for
 * service-owned catalog/import inspection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { hasAllowedSupabaseProtocol } from '../src/lib/supabaseUrl.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const frontPath = path.join(root, '.env.local');
const importPath = path.join(root, '.env.import.local');
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const strict = args.has('--strict');
const oldHost = 'qczsdnmwtagwbofpvwle.supabase.co';

function readEnv(file) {
  if (!fs.existsSync(file)) return null;
  return parse(fs.readFileSync(file, 'utf8'));
}

function isServerSecretName(key) {
  return /SERVICE_ROLE|SERVICE_KEY|SECRET|SERVICE/i.test(key);
}

function printEnvPresence(front, imported) {
  for (const [label, env] of [['.env.local', front], ['.env.import.local', imported]]) {
    if (env == null) {
      console.log(`${label}: MISSING`);
      continue;
    }
    const keys = Object.keys(env).filter((k) => k && !k.startsWith('#'));
    console.log(`${label}: ${keys.length} keys present`);
  }
}

function fail(lines) {
  for (const line of lines) console.error(`[check:supabase] ${line}`);
  process.exit(2);
}

const front = readEnv(frontPath);
const imported = readEnv(importPath);
printEnvPresence(front, imported);

const missing = [];
if (front == null) missing.push('缺少 .env.local（从 .env.example 复制并填写）');
if (imported == null) missing.push('缺少 .env.import.local（从 .env.import.example 复制并填写）');
if (missing.length) fail(missing);

const frontUrl = (front.VITE_SUPABASE_URL || '').trim();
const anonKey = (front.VITE_SUPABASE_ANON_KEY || front.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
const importUrl = (imported.SUPABASE_URL || '').trim();
const serviceKey = (imported.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const cacheFlag = (front.VITE_CACHE_API_ENABLED || '').trim().toLowerCase();

const errors = [];
function requireValue(condition, message) {
  if (!condition) errors.push(message);
}
requireValue(frontUrl, '缺少 VITE_SUPABASE_URL');
requireValue(anonKey, '缺少 VITE_SUPABASE_ANON_KEY 或 VITE_SUPABASE_PUBLISHABLE_KEY');
requireValue(importUrl, '缺少 .env.import.local 的 SUPABASE_URL');
requireValue(serviceKey, '缺少 .env.import.local 的 SUPABASE_SERVICE_ROLE_KEY');
requireValue(cacheFlag === 'false', 'VITE_CACHE_API_ENABLED 必须显式为 false（本地直连，不启用缓存 API）');

if (frontUrl && importUrl) {
  try {
    const a = new URL(frontUrl);
    const b = new URL(importUrl);
    requireValue(hasAllowedSupabaseProtocol(a) && hasAllowedSupabaseProtocol(b),
      '两个 Supabase URL 必须使用 https；仅本机回环地址允许 http');
    requireValue(a.origin === b.origin, '前端 VITE_SUPABASE_URL 与导入 SUPABASE_URL 不是同一个项目/源');
    requireValue(a.hostname !== oldHost && b.hostname !== oldHost, '检测到旧校 Supabase 项目，拒绝使用');
    requireValue(a.pathname === '/' || a.pathname === '', 'VITE_SUPABASE_URL 不应带额外路径');
    requireValue(b.pathname === '/' || b.pathname === '', 'SUPABASE_URL 不应带额外路径');
  } catch {
    errors.push('Supabase URL 不是合法 URL');
  }
}
requireValue(anonKey !== serviceKey, '匿名 key 与 service_role key 不能相同');
requireValue(!Object.keys(front).some((k) => isServerSecretName(k)), '.env.local 中存在服务端密钥类变量；service_role 不得进入前端');
requireValue(!Object.values(front).includes(serviceKey), '.env.local 中出现了 service_role key；禁止进入前端');
requireValue(!Object.keys(imported).some((k) => k.startsWith('VITE_')), '.env.import.local 不应包含 VITE_ 前端变量');

if (errors.length) fail(errors);

const projectHost = new URL(frontUrl).host;
console.log(JSON.stringify({
  ok: true,
  projectHost,
  sameProject: true,
  cacheApiEnabled: false,
  frontendKeyKind: front.VITE_SUPABASE_PUBLISHABLE_KEY ? 'publishable' : 'anon',
  serviceKeyPresent: true,
  remoteChecks: remote,
}, null, 2));
console.log('[check:supabase] configuration is consistent; no secret values were printed.');

if (!remote) process.exit(0);

async function request(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

const anonHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
};
const serviceHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};
const base = frontUrl.replace(/\/$/, '');

function totalFromContentRange(response) {
  const value = response.headers.get('content-range') || '';
  const total = Number(value.split('/').at(-1));
  return Number.isFinite(total) ? total : null;
}

async function countRest(table, filter = '') {
  const response = await request(
    `${base}/rest/v1/${table}?select=id&limit=1${filter ? `&${filter}` : ''}`,
    { ...serviceHeaders, Prefer: 'count=exact', Range: '0-0' },
  );
  if (!response.ok) throw new Error(`service_role 统计 ${table} 失败（HTTP ${response.status}）`);
  return totalFromContentRange(response);
}

async function fetchAllRows(table, select) {
  const rows = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const response = await request(
      `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${page}&offset=${offset}`,
      { ...serviceHeaders, Range: `${offset}-${offset + page - 1}` },
    );
    if (!response.ok) throw new Error(`service_role 读取 ${table} 失败（HTTP ${response.status}）`);
    const body = Array.isArray(response.body) ? response.body : [];
    rows.push(...body);
    const total = totalFromContentRange(response);
    if (total != null ? rows.length >= total : body.length < page) break;
  }
  return rows;
}

try {
  const settings = await request(`${base}/auth/v1/settings`, anonHeaders);
  if (!settings.ok) throw new Error(`Auth settings 不可读（HTTP ${settings.status}）`);
  const auth = settings.body || {};
  console.log(JSON.stringify({
    authReachable: true,
    emailEnabled: Boolean(auth.external?.email),
    mailerAutoconfirm: auth.mailer_autoconfirm ?? null,
    disableSignup: auth.disable_signup ?? null,
  }, null, 2));

  const anonColleges = await request(`${base}/rest/v1/colleges?select=code&limit=1`, anonHeaders);
  if (!anonColleges.ok) throw new Error(`匿名读取 colleges 失败（HTTP ${anonColleges.status}）`);
  console.log(JSON.stringify({ anonCatalogReadable: true, collegesSample: anonColleges.body }, null, 2));

  const [teacherCount, offeringCount, collegeCount, terms, batches, campusSet, chemistryColleges, courseRows] = await Promise.all([
    countRest('teachers'),
    countRest('course_offerings'),
    countRest('colleges'),
    request(`${base}/rest/v1/terms?select=code,is_current`, serviceHeaders),
    request(`${base}/rest/v1/import_batches?select=dataset,imported_at&order=imported_at.desc&limit=50`, serviceHeaders),
    request(`${base}/rest/v1/teachers?select=id,campus,college:colleges(code)&campus=not.is.null`, serviceHeaders),
    request(`${base}/rest/v1/colleges?select=id&code=eq.upc-03`, serviceHeaders),
    fetchAllRows('courses', 'name,code'),
  ]);
  for (const [label, response] of Object.entries({ terms, batches, campusSet, chemistryColleges })) {
    if (!response.ok) throw new Error(`service_role 读取 ${label} 失败（HTTP ${response.status}）`);
  }
  const chemistryCollegeId = Array.isArray(chemistryColleges.body) ? chemistryColleges.body[0]?.id : null;
  const [chemistryTeacherCount, chemistryOfferings, chemistryExtensionTeachers, chemistryExtensionOfferings] = chemistryCollegeId
    ? await Promise.all([
      countRest('teachers', 'source_id=like.cce-*'),
      request(`${base}/rest/v1/course_offerings?select=course_id,teachers!inner(source_id)&teachers.source_id=like.cce-*`, serviceHeaders),
      countRest('teachers', 'source_id=like.tt-upc-03-*'),
      request(`${base}/rest/v1/course_offerings?select=course_id,teachers!inner(source_id)&teachers.source_id=like.tt-upc-03-*`, serviceHeaders),
    ])
    : [null, { ok: false, body: [] }, null, { ok: false, body: [] }];
  if (!chemistryOfferings.ok || !chemistryExtensionOfferings.ok) {
    throw new Error('service_role 读取 chemistry baseline/extension offers 失败');
  }
  const chemistryCourseIds = new Set((chemistryOfferings.body || []).map((row) => row.course_id));
  const chemistryExtensionCourseIds = new Set((chemistryExtensionOfferings.body || []).map((row) => row.course_id));
  const groups = new Map();
  for (const course of courseRows) {
    if (course.name && course.code) {
      if (!groups.has(course.name)) groups.set(course.name, new Set());
      groups.get(course.name).add(course.code);
    }
  }
  const sameNameGroups = [...groups.values()].filter((codes) => codes.size > 1).length;
  const term = Array.isArray(terms.body) ? terms.body.find((t) => t.code === '2026-2027-1') : null;
  const campusRows = Array.isArray(campusSet.body) ? campusSet.body : [];
  const chemistryWithCampus = campusRows.filter((row) => {
    const college = Array.isArray(row.college) ? row.college[0] : row.college;
    return college?.code === 'upc-03';
  }).length;
  const summary = {
    teachers: teacherCount,
    courses: courseRows.length,
    offerings: offeringCount,
    colleges: collegeCount,
    sameNameDifferentCodeGroups: sameNameGroups,
    term: term || null,
    teachersWithCampus: chemistryWithCampus,
    teachersWithCampusAllColleges: campusRows.length,
    chemistry: {
      teachers: chemistryTeacherCount,
      courses: chemistryCourseIds.size,
      offerings: Array.isArray(chemistryOfferings.body) ? chemistryOfferings.body.length : null,
    },
    chemistryExtension: {
      teachers: chemistryExtensionTeachers,
      courses: chemistryExtensionCourseIds.size,
      offerings: Array.isArray(chemistryExtensionOfferings.body) ? chemistryExtensionOfferings.body.length : null,
    },
    importBatches: Array.isArray(batches.body) ? batches.body : [],
  };
  const manifestPath = path.join(root, 'data', 'upc', 'timetables-2026-2027-1', 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const expected = manifest?.expected || {
    teachers: 1555, courses: 1342, offerings: 2946, sameNameDifferentCodeGroups: 133,
  };
  expected.collegeCount = manifest?.collegeCount ?? 17;
  const chemistryExpected = manifest?.chemistry || {
    teachers: 136, courses: 129, offerings: 271, sameNameDifferentCodeGroups: 16,
  };
  const chemistryExtensionExpected = manifest?.chemistryExtension || {
    teachers: 7, coursesTouched: 12, newCourses: 0, offerings: 13,
  };
  console.log(JSON.stringify({ expected, chemistryExpected, chemistryExtensionExpected, dataChecks: summary }, null, 2));

  if (strict) {
    const totalsOk = summary.teachers === expected.teachers && summary.courses === expected.courses
      && summary.offerings === expected.offerings && summary.colleges === expected.collegeCount
      && summary.sameNameDifferentCodeGroups === expected.sameNameDifferentCodeGroups;
    const chemistryOk = summary.chemistry.teachers === chemistryExpected.teachers
      && summary.chemistry.courses === chemistryExpected.courses
      && summary.chemistry.offerings === chemistryExpected.offerings;
    const chemistryExtensionOk = summary.chemistryExtension.teachers === chemistryExtensionExpected.teachers
      && summary.chemistryExtension.courses === chemistryExtensionExpected.coursesTouched
      && summary.chemistryExtension.offerings === chemistryExtensionExpected.offerings;
    const baseOk = summary.term?.code === '2026-2027-1' && summary.term?.is_current === false
      && summary.teachersWithCampusAllColleges === 0 && summary.importBatches.length >= 1;
    if (!totalsOk || !chemistryOk || !chemistryExtensionOk || !baseOk) {
      console.error('[check:supabase] strict target data check failed.');
      console.error(`[check:supabase] totals expected ${JSON.stringify(expected)}, actual ${JSON.stringify({
        teachers: summary.teachers, courses: summary.courses, offerings: summary.offerings,
        colleges: summary.colleges, sameNameDifferentCodeGroups: summary.sameNameDifferentCodeGroups,
      })}`);
      console.error(`[check:supabase] chemistry expected ${JSON.stringify(chemistryExpected)}, actual ${JSON.stringify(summary.chemistry)}`);
      console.error(`[check:supabase] chemistry extension expected ${JSON.stringify(chemistryExtensionExpected)}, actual ${JSON.stringify(summary.chemistryExtension)}`);
      console.error(`[check:supabase] term=${summary.term?.code}/${summary.term?.is_current}, campusNonEmpty=${summary.teachersWithCampusAllColleges}, batches=${summary.importBatches.length}`);
      process.exit(1);
    }
    console.log('[check:supabase] strict target data check passed (manifest totals + chemistry subset + term/campus).');
  }
  console.log('[check:supabase] remote checks completed without printing secrets.');
} catch (error) {
  console.error(`[check:supabase] remote check failed: ${error.message}`);
  process.exit(1);
}
