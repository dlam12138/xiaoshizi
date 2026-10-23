#!/usr/bin/env node
/**
 * Export the public UPC directory as a small, rebuildable, sanitized release.
 *
 * It reads only the directory tables. Auth users, admin accounts, reviews,
 * review text, points, likes, import actors, database dumps, browser state and
 * contact details are deliberately excluded.
 *
 * Usage (with a local or target service-role environment):
 *   node scripts/export-upc-release.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const out = path.resolve('data/upc/release');
const pageSize = 1000;

async function readAll(table, columns, order) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(columns).range(from, from + pageSize - 1);
    for (const [column, ascending] of order) query = query.order(column, { ascending });
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function write(name, value) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
  return digest(value);
}
function countsFromSummary(summary) {
  const result = { success: summary?.success === true, dryRun: summary?.dryRun === true };
  for (const key of ['term', 'courses', 'teachers', 'offerings']) {
    const row = summary?.[key] || {};
    result[key] = {
      inserted: Number(row.inserted || 0),
      updated: Number(row.updated || 0),
      skipped: Number(row.skipped || 0),
    };
  }
  return result;
}

fs.mkdirSync(out, { recursive: true });

const colleges = await readAll('colleges', 'id,code,name,aliases,campus,created_at', [['code', true]]);
const terms = await readAll('terms', 'id,code,year_term,is_current,created_at', [['code', true]]);
const teachers = await readAll('teachers',
  'id,source_id,name,title,college_id,campus,tags,has_historical_data,created_at',
  [['name', true], ['id', true]]);
const courses = await readAll('courses', 'id,code,name,college_id,created_at', [['name', true], ['id', true]]);
const offerings = await readAll('course_offerings', 'id,teacher_id,course_id,term_id,source_id,created_at',
  [['teacher_id', true], ['course_id', true], ['id', true]]);
const rawBatches = await readAll('import_batches', 'dataset,checksum,summary,imported_at', [['imported_at', true]]);
const importBatches = rawBatches.map((row) => ({
  dataset: row.dataset,
  checksum: row.checksum,
  imported_at: row.imported_at,
  counts: countsFromSummary(row.summary),
}));

const files = {};
files['colleges.json'] = write('colleges.json', colleges);
files['terms.json'] = write('terms.json', terms);
files['teachers.json'] = write('teachers.json', teachers);
files['courses.json'] = write('courses.json', courses);
files['course-offerings.json'] = write('course-offerings.json', offerings);
files['import-batches.json'] = write('import-batches.json', importBatches);

const teacherIds = new Set(teachers.map((row) => row.id));
const courseIds = new Set(courses.map((row) => row.id));
const termIds = new Set(terms.map((row) => row.id));
const collegeIds = new Set(colleges.map((row) => row.id));
const dangling = offerings.filter((row) =>
  !teacherIds.has(row.teacher_id) || !courseIds.has(row.course_id) || !termIds.has(row.term_id));
if (dangling.length) throw new Error(`Directory export has ${dangling.length} dangling offerings`);
if (teachers.some((row) => !collegeIds.has(row.college_id))) throw new Error('Teacher with unknown college');
if (courses.some((row) => !collegeIds.has(row.college_id))) throw new Error('Course with unknown college');

const manifest = {
  schemaVersion: 1,
  dataset: 'upc-public-directory-2026-2027-1',
  generatedAt: new Date().toISOString(),
  scope: 'Public teacher/course/offering directory for local acceptance.',
  counts: {
    colleges: colleges.length,
    terms: terms.length,
    teachers: teachers.length,
    courses: courses.length,
    offerings: offerings.length,
    importBatches: importBatches.length,
  },
  files,
  sourceData: [
    'data/upc/colleges.json',
    'data/upc/chemistry-2026-2027-1/import.json',
    'data/upc/timetables-2026-2027-1/units/*/import.json',
    'data/upc/timetables-2026-2027-1/import-all.json',
    'scripts/upc-timetable/',
  ],
  sanitization: {
    includes: ['public teacher names and public academic identities', 'course codes/names',
      'college/term identifiers', 'teacher-course-term relations', 'sanitized import counts and hashes'],
    excludes: ['auth.users and passwords/sessions', 'admin_users and service_role keys',
      'user_profiles/points/transactions', 'reviews and review text', 'review_likes',
      'imported_by user IDs', 'database dumps', 'browser state and local logs',
      'personal phone/email/contact details', 'machine absolute paths'],
  },
  rebuild: {
    schema: 'supabase/upc-init.sql',
    import: 'npm run data:import -- data/upc/chemistry-2026-2027-1/import.json',
  },
};
write('manifest.json', manifest);
console.log(JSON.stringify({ out: out.replaceAll('\\', '/'), ...manifest.counts }, null, 2));
