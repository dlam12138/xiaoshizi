import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const dir = path.resolve('data/upc/release');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('release directory is complete, sanitized and hash-verified', () => {
  const manifest = read('manifest.json');
  assert.deepEqual(manifest.counts, {
    colleges: 17, terms: 1, teachers: 1555, courses: 1342, offerings: 2946, importBatches: 44,
  });
  const colleges = read('colleges.json');
  const terms = read('terms.json');
  const teachers = read('teachers.json');
  const courses = read('courses.json');
  const offerings = read('course-offerings.json');
  const batches = read('import-batches.json');
  assert.equal(teachers.length, 1555);
  assert.equal(courses.length, 1342);
  assert.equal(offerings.length, 2946);
  assert.equal(batches.length, 44);
  assert.equal(new Set(teachers.map(t => t.id)).size, 1555);
  assert.equal(new Set(courses.map(c => c.id)).size, 1342);
  assert.equal(new Set(offerings.map(o => o.id)).size, 2946);
  const collegeIds = new Set(colleges.map(c => c.id));
  const termIds = new Set(terms.map(t => t.id));
  const teacherIds = new Set(teachers.map(t => t.id));
  const courseIds = new Set(courses.map(c => c.id));
  assert.ok(teachers.every(t => collegeIds.has(t.college_id)));
  assert.ok(courses.every(c => collegeIds.has(c.college_id)));
  assert.ok(offerings.every(o => teacherIds.has(o.teacher_id) && courseIds.has(o.course_id) && termIds.has(o.term_id)));
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.equal(digest(read(file)), hash, `${file} hash mismatch`);
  }
  const joined = JSON.stringify({ teachers, courses, offerings, batches });
  assert.doesNotMatch(joined, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(joined, /(^|["'])(?:email|phone|mobile|telephone|contact|wechat|qq)(["']|:)/i);
  assert.doesNotMatch(joined, /imported_by|user_id|password|service_role/i);
  assert.doesNotMatch(joined, /[A-Za-z]:\\\\|C:\\\\Users|\/mnt\/[a-z]\//);
  assert.ok(teachers.every(t => !('overall_score' in t) && !('review_count' in t)));
});
