import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { hasAllowedSupabaseProtocol } from '../src/lib/supabaseUrl.mjs';

dotenv.config({ path: '.env.import.local', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const collegeData = JSON.parse(
  fs.readFileSync(new URL('../data/upc/colleges.json', import.meta.url), 'utf8'),
);
const UPC_COLLEGES = collegeData.colleges;
const UPC_CAMPUSES = collegeData.campuses;

const args = process.argv.slice(2);
const fileArg = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const allowFixture = args.includes('--allow-fixture');
const validateOnly = args.includes('--validate-only');

function fail(message) {
  console.error(`[import:upc] ${message}`);
  process.exit(1);
}

if (!fileArg) {
  fail('用法: npm run import:upc -- <data.json> [--dry-run] [--allow-fixture] [--validate-only]');
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) fail(`文件不存在: ${filePath}`);

const raw = fs.readFileSync(filePath);
const checksum = createHash('sha256').update(raw).digest('hex');
let payload;
try {
  payload = JSON.parse(raw.toString('utf8'));
} catch (error) {
  fail(`JSON 解析失败: ${error.message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

assert(payload && typeof payload === 'object' && !Array.isArray(payload), '导入文件必须是 JSON 对象');
assert(payload.schemaVersion === 1, 'schemaVersion 必须为 1');
assert(typeof payload.dataset === 'string' && payload.dataset.trim(), 'dataset 必填');
assert(typeof payload.source === 'string' && payload.source.trim(), 'source 必填');
assert(Array.isArray(payload.teachers) && payload.teachers.length > 0, 'teachers 必须是非空数组');
if (payload.dataset.startsWith('fixture-') && !allowFixture) {
  fail('dataset 标记为测试夹具；真实导入请使用正式数据集，本地验证需显式加 --allow-fixture');
}
if (/swjtu|qczsdnmwtagwbofpvwle/i.test(JSON.stringify(payload))) {
  fail('导入数据包含旧校标识或旧项目地址，拒绝导入');
}

const collegeByCode = new Map(UPC_COLLEGES.map((college) => [college.code, college]));
const campusSet = new Set(UPC_CAMPUSES);
const seenSourceIds = new Set();
const term = payload.term;

if (term != null) {
  assert(typeof term === 'object' && !Array.isArray(term), 'term 必须是对象或 null');
  assert(typeof term.code === 'string' && term.code.trim(), 'term.code 必填');
  assert(typeof term.name === 'string' && term.name.trim(), 'term.name 必填');
  assert(typeof term.isCurrent === 'boolean', 'term.isCurrent 必须是布尔值');
}

payload.teachers.forEach((teacher, index) => {
  const label = `teachers[${index}]`;
  assert(teacher && typeof teacher === 'object', `${label} 必须是对象`);
  assert(typeof teacher.sourceId === 'string' && teacher.sourceId.trim(), `${label}.sourceId 必填`);
  assert(!seenSourceIds.has(teacher.sourceId), `${label}.sourceId 重复: ${teacher.sourceId}`);
  seenSourceIds.add(teacher.sourceId);
  assert(typeof teacher.name === 'string' && teacher.name.trim(), `${label}.name 必填`);
  assert(!teacher.title || typeof teacher.title === 'string', `${label}.title 必须是字符串`);
  assert(collegeByCode.has(teacher.collegeCode), `${label}.collegeCode 不在学院字典中: ${teacher.collegeCode}`);
  if (teacher.campus != null) {
    assert(campusSet.has(teacher.campus), `${label}.campus 不在 UPC 校区枚举中: ${teacher.campus}`);
  }
  const courses = teacher.courses ?? [];
  assert(Array.isArray(courses), `${label}.courses 必须是数组`);
  if (courses.length > 0) {
    assert(term, `${label} 有课程但整批没有 term`);
    courses.forEach((course, courseIndex) => {
      assert(course && typeof course === 'object', `${label}.courses[${courseIndex}] 必须是对象`);
      assert(typeof course.name === 'string' && course.name.trim(), `${label}.courses[${courseIndex}].name 必填`);
      assert(!course.code || typeof course.code === 'string', `${label}.courses[${courseIndex}].code 必须是字符串`);
      if (course.collegeCode != null) {
        assert(collegeByCode.has(course.collegeCode),
          `${label}.courses[${courseIndex}].collegeCode 不在学院字典中: ${course.collegeCode}`);
      }
    });
  }
});

if (validateOnly) {
  const courseCount = payload.teachers.reduce((sum, teacher) => sum + (teacher.courses?.length || 0), 0);
  console.log(JSON.stringify({
    ok: true,
    validatedOnly: true,
    dataset: payload.dataset,
    term: payload.term,
    teachers: payload.teachers.length,
    teacherCourseRows: courseCount,
    checksum,
  }, null, 2));
  process.exit(0);
}

const url = (process.env.SUPABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
assert(url, '缺少 SUPABASE_URL（不要使用 VITE_ 前缀的服务端环境）');
let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  fail('SUPABASE_URL 不是合法 URL');
}
assert(hasAllowedSupabaseProtocol(parsedUrl), 'SUPABASE_URL 必须使用 https；仅本机回环地址允许 http');
assert(!url.includes('qczsdnmwtagwbofpvwle'), '拒绝旧校 Supabase 项目');
assert(serviceKey, '缺少 SUPABASE_SERVICE_ROLE_KEY（仅服务端导入使用，不能写入前端）');

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

console.log(JSON.stringify({
  phase: 'calling-import-rpc',
  file: path.basename(filePath),
  dataset: payload.dataset,
  teachers: payload.teachers.length,
  dryRun,
  checksum,
}));

const { data, error } = await client.rpc('import_upc_dataset', {
  p_payload: payload,
  p_checksum: checksum,
  p_dry_run: dryRun,
});

if (error) {
  console.error(`[import:upc] 导入失败，整批已回滚: ${error.message}`);
  if (error.details) console.error(`detail: ${error.details}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, result: data }, null, 2));
