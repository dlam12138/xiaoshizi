import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.mjs';

async function fixture(t) {
  const calls = [];
  const cache = { available: true, lastSync: 1,
    teachers: async () => ({ cache: 'HIT', rows: [{ id: 'upc:fixture-teacher', name: 'Teacher', overall_score: 4 }] }),
    reviews: async () => ({ cache: 'HIT', rows: [{ id: 'r', teacher_id: 't', status: 'approved', created_at: '2026-01-01' }] }),
    mutate: operation => operation(), changedReview: async (...args) => { calls.push(['refresh', ...args]); },
  };
  const authClient = { auth: { getUser: async token => ({ data: { user: token === 'invalid' ? null : { id: token } } }) } };
  const userClient = token => ({
    from(table) {
      calls.push(['from', table]);
      let operation = 'read';
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id: 'r', teacher_id: 't', status: 'approved', user_id: 'student' } }),
        delete: () => { operation = 'delete'; return query; },
        update: payload => { calls.push(['update', payload]); operation = 'update'; return query; },
        then: resolve => Promise.resolve({ data: token === 'admin' || operation === 'update' ? [{ id: 'r' }] : [] }).then(resolve),
      }; return query;
    },
    async rpc(name, args) {
      calls.push(['rpc', token, name, args]);
      if (name === 'set_review_like') return { data: { likes: 4, liked: args.p_liked, teacher_id: 'upc:fixture-teacher' } };
      if (token !== 'admin') return { error: { message: 'permission denied' } };
      return { data: { success: true } };
    },
  });
  const server = createApp({ cache, authClient, userClient }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { calls, request: (path, token, method = 'GET', body) => fetch(base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }) };
}

test('phase-one API hides timetable and notices and reports health', async t => {
  const f = await fixture(t);
  const health = await f.request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true, cache: 'ready', lastSync: 1, timetable: 'disabled',
  });
  assert.equal((await f.request('/api/timetable/recommendations?query=Calculus')).status, 404);
  assert.equal((await f.request('/api/notices')).status, 404);
  assert.equal(f.calls.length, 0);
});
test('public reads use cache while privileged routes reject absent or invalid sessions', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/teachers');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-cache'), 'HIT');
  assert.equal((await response.json()).data.total, 1);
  const teacher = await f.request('/api/teachers/upc%3Afixture-teacher');
  assert.equal(teacher.status, 200);
  assert.equal((await teacher.json()).data.id, 'upc:fixture-teacher');
  assert.equal((await f.request('/api/teachers/upc%3Afixture-teacher/reviews')).status, 200);
  assert.equal((await f.request('/api/reviews/r/approve', undefined, 'POST')).status, 401);
  assert.equal((await f.request('/api/reviews/r/approve', 'invalid', 'POST')).status, 401);
  assert.equal(f.calls.length, 0);
});
test('moderation preserves database authorization and only successful writes refresh cache', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/reviews/r/approve', 'student', 'POST')).status, 400);
  assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 0);
  assert.equal((await f.request('/api/reviews/r/approve', 'admin', 'POST')).status, 200);
  assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 1);
  assert.equal((await f.request('/api/reviews/r', 'student', 'DELETE')).status, 403);
  assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 1);
});
test('like refresh is limited to the affected review and malformed state is rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/reviews/r/like', 'student', 'POST', { liked: 'yes' })).status, 400);
  const response = await f.request('/api/reviews/r/like', 'student', 'POST', { liked: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { likes: 4, liked: true } });
  assert.deepEqual(f.calls.at(-1), ['refresh', 'upc:fixture-teacher', 'r', { teacherChanged: false }]);
  // A normal user's like must be authorized by the SECURITY DEFINER RPC, not by
  // a base-table SELECT that RLS intentionally hides for other users' reviews.
  assert.ok(!f.calls.some(c => c[0] === 'from' && c[1] === 'reviews'));
});
test('editing ignores caller supplied identity, status and review metadata', async t => {
  const f = await fixture(t);
  const ratings = {
    attendance_strictness: 4, grading_leniency: 4.1, effort_matters: 4.2,
    workload_difficulty: 4.3, approachability: 4.4, teaching_quality: 4.5,
  };
  assert.equal((await f.request('/api/reviews/r', 'student', 'PATCH', {
    rating_version: 2, term_id: 'term-2', comment: 'updated', status: 'approved',
    user_id: 'admin', likes: 999, reviewer_id: 'admin', ...ratings,
  })).status, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'update')[1], {
    rating_version: 2, term_id: 'term-2', comment: 'updated', ...ratings,
    status: 'pending', reject_reason: null,
  });
  const before = f.calls.length;
  assert.equal((await f.request('/api/reviews/r', 'student', 'PATCH', {
    rating_version: 2, term_id: 'term-2', ...ratings, attendance_strictness: 4.15,
  })).status, 400);
  assert.equal(f.calls.length, before);
});
