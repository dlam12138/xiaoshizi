import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { CatalogCache } from '../cache.mjs';

const base = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3001';
const headers = process.env.VERIFY_HOST ? { Host: process.env.VERIFY_HOST } : {};
const { SUPABASE_URL, SUPABASE_ANON_KEY, REDIS_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !REDIS_PASSWORD) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and REDIS_PASSWORD before verification');
}
if (SUPABASE_URL.includes('qczsdnmwtagwbofpvwle')) {
  throw new Error('Refusing the retired SWJTU Supabase project');
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const get = async (path) => {
  const start = performance.now();
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200, path);
  const body = await response.json();
  assert.ok(body && Object.prototype.hasOwnProperty.call(body, 'data'), `${path} response shape`);
  return { data: body.data, cache: response.headers.get('x-cache'), ms: Math.round(performance.now() - start) };
};

const healthResponse = await fetch(base + '/health', { headers });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ok, true);
assert.equal(health.timetable, 'disabled', 'phase one must not expose timetable');

const first = await get('/api/teachers');
assert.equal(first.data.items.length, Math.min(20, first.data.total));
for (const teacher of first.data.items) {
  assert.equal('email' in teacher, false);
  assert.equal('source_id' in teacher, false);
}

if (first.data.total > 0) {
  const direct = await db.from('teachers').select('id', { count: 'exact' })
    .order('name', { ascending: true }).order('id', { ascending: true })
    .range(0, Math.min(19, first.data.total - 1));
  assert.ifError(direct.error);
  assert.equal(first.data.total, direct.count);
  assert.deepEqual(first.data.items.map((row) => row.id), direct.data.map((row) => row.id));

  const teacherId = first.data.items[0].id;
  assert.ok(teacherId.startsWith('upc:'), 'imported teacher IDs must use the upc: namespace');
  const reviews = await get(`/api/teachers/${encodeURIComponent(teacherId)}/reviews?pageSize=100`);
  for (const row of reviews.data.items) {
    assert.equal(row.status, 'approved');
    for (const field of ['user_id', 'user_email', 'reviewer_id', 'reject_reason', 'reviewed_at']) {
      assert.equal(field in row, false, `private field ${field} leaked`);
    }
  }
}

const denied = await fetch(base + '/api/reviews/verification/approve', { method: 'POST', headers });
assert.equal(denied.status, 401);
assert.equal((await fetch(base + '/api/notices')).status, 404, 'retired notices route');
assert.equal((await fetch(base + '/api/timetable/recommendations')).status, 404, 'hidden timetable route');

const redis = new Redis({
  host: '127.0.0.1',
  username: process.env.REDIS_USERNAME,
  password: REDIS_PASSWORD,
});
const prefix = `${process.env.CACHE_PREFIX || 'upc:cache:v1:'}verification:${randomUUID()}:`;
const state = { teachers: [{ id: 'test-teacher', review_count: 1 }], reviews: [{ id: 'test-review', likes: 1 }] };
let teacherDownloads = 0;
let reviewDownloads = 0;
const source = {
  teachers: async () => { teacherDownloads++; return state.teachers; },
  teacher: async () => state.teachers[0],
  reviews: async () => { reviewDownloads++; return state.reviews; },
  review: async () => state.reviews[0] || null,
};
const cache = new CatalogCache(redis, source, { prefix, logger: { info() {}, warn() {} } });
try {
  await cache.teachers();
  await cache.reviews('test-teacher');
  state.teachers[0].review_count = 2;
  state.reviews[0].likes = 4;
  await cache.changedReview('test-teacher', 'test-review');
  assert.equal((await cache.teachers()).rows[0].review_count, 2);
  assert.equal((await cache.reviews('test-teacher')).rows[0].likes, 4);
  state.reviews = [];
  await cache.changedReview('test-teacher', 'test-review');
  assert.equal((await cache.reviews('test-teacher')).rows.length, 0);
  assert.equal(teacherDownloads, 1);
  assert.equal(reviewDownloads, 1);
} finally {
  await redis.del(cache.teacherKey, cache.reviewKey('test-teacher'));
  await redis.quit();
}

console.log(JSON.stringify({
  verified: true,
  teachers: first.data.total,
  reviewsFirstPage: first.data.total > 0 ? 'checked' : 'empty',
  phaseOneRoutes: 'hidden',
  incrementalRedisUpdates: 'passed',
  authorization: 'passed',
  cacheMs: first.ms,
}));
