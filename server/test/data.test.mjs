import test from 'node:test';
import assert from 'node:assert/strict';
import { readAll, publicTeacher, publicReview, createSource, teacherOptions, teacherPage, reviewPage, validateNewRatingPayload } from '../data.mjs';

test('snapshot reads all pages even when the database caps results below 500', async () => {
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: String(i) }));
  const loaded = await readAll(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + 100)), count: from === 0 ? rows.length : null }));
  assert.deepEqual(loaded, rows);
  await assert.rejects(readAll(async from => ({ data: from ? [] : rows.slice(0, 100), count: 1234 })), /changed/);
});
test('public review source reads the safe view instead of the base table', async () => {
  const reads = [];
  const client = {
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: (from, to) => {
          reads.push({ table, from, to });
          return Promise.resolve({
            data: [{
              id: 'r1', teacher_id: 't1', course_id: 'c1', term_id: 'term',
              year_term: '2026', status: 'approved', created_at: '2026-10-01',
              rating_version: 2, course_name: '公开课程', teacher_name: '公开教师',
              user_id: 'must-not-leak',
            }],
            count: 1,
            error: null,
          });
        },
      };
      return query;
    },
  };
  const source = createSource(client);
  const rows = await source.reviews('t1');
  assert.equal(reads[0].table, 'review_feed');
  assert.equal(rows[0].course_name, '公开课程');
  assert.equal(rows[0].teachers.name, '公开教师');
  assert.ok(!JSON.stringify(rows).includes('must-not-leak'));
});

test('public records strip identity and moderation fields, and exclude unapproved content', () => {
  const secret = { user_id: 'private', user_email: 'secret@example.test', reviewer_id: 'admin', reject_reason: 'private' };
  const row = publicReview({ id: 'r', teacher_id: 't', status: 'approved', comment: 'public', ...secret, teachers: { name: 'Teacher', ...secret } });
  assert.equal(row.comment, 'public');
  assert.ok(!JSON.stringify(row).includes('private'));
  assert.ok(!JSON.stringify(row).includes('secret'));
  assert.equal(publicReview({ status: 'pending', comment: 'hidden' }), null);
  assert.ok(!JSON.stringify(publicTeacher({ id: 't', ...secret })).includes('private'));
});
test('teacher search preserves course matching, exact tags, semester filters and stable paging', () => {
  const rows = [
    { id: 'b', name: 'Beta', overall_score: 5, review_count: 2, tags: ['exact'], college_id: 'c', course_offerings: [{ courses: { name: 'Calculus' }, terms: { is_current: true } }] },
    { id: 'z', name: 'Zeta', overall_score: 5, review_count: 99, tags: [], college_id: 'c', course_offerings: [] },
    { id: 'a', name: 'Alpha', overall_score: 4, review_count: 2, tags: [], college_id: 'c', course_offerings: [] },
    { id: 'c', name: 'Other', overall_score: null, tags: [], college_id: 'd', course_offerings: [] },
  ];
  assert.deepEqual(teacherPage(rows, teacherOptions({ pageSize: '1' })).items.map(r => r.id), ['a']);
  assert.deepEqual(teacherPage(rows, teacherOptions({ pageSize: '1', page: '1' })).items.map(r => r.id), ['b']);
  assert.deepEqual(teacherPage(rows, teacherOptions({ pageSize: '1', page: '2' })).items.map(r => r.id), ['c']);
  assert.equal(teacherPage(rows, teacherOptions({ query: 'CALCULUS', courseOnly: 'true', onlyThisTerm: 'true' })).total, 1);
  assert.equal(teacherPage(rows, teacherOptions({ query: 'exa' })).total, 0);
  assert.equal(teacherPage(rows, teacherOptions({ query: 'exact' })).total, 1);
  assert.equal(teacherPage(rows, teacherOptions({ query: '%_*' })).total, 0);
  assert.equal(teacherOptions({ sortBy: 'overall' }).sortBy, undefined);
  assert.throws(() => teacherOptions({ pageSize: '101' }));
});
test('new rating payloads require six values in 4.0–5.0 with one decimal', () => {
  const base = {
    attendance_strictness: 4, grading_leniency: 4.1, effort_matters: 4.9,
    workload_difficulty: 5, approachability: 4.0, teaching_quality: 4.5,
  };
  assert.equal(validateNewRatingPayload(base), null);
  assert.match(validateNewRatingPayload({ ...base, attendance_strictness: 4.15 }), /one decimal/);
  assert.match(validateNewRatingPayload({ ...base, attendance_strictness: 3.9 }), /between 4.0 and 5.0/);
  assert.match(validateNewRatingPayload({ ...base, attendance_strictness: 5.1 }), /between 4.0 and 5.0/);
  assert.match(validateNewRatingPayload({ ...base, teaching_quality: undefined }), /required/);
});
test('review pagination preserves timestamp ordering and an ID tie breaker', () => {
  const rows = [{ id: 'b', created_at: '2026-01-01T00:00:00Z' }, { id: 'a', created_at: '2026-01-01T00:00:00Z' }, { id: 'c', created_at: '2026-02-01T00:00:00Z' }];
  assert.deepEqual(reviewPage(rows, { page: 0, pageSize: 2 }).items.map(r => r.id), ['c', 'a']);
  assert.deepEqual(reviewPage(rows, { page: 1, pageSize: 2 }).items.map(r => r.id), ['b']);
});
