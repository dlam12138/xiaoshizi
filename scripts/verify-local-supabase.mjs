// Legacy pre-security acceptance runner. It creates non-student accounts and
// writes comment text, so it is not compatible with the launch rules. Use
// `npm run test:supabase:local` (auth + database security checks) instead.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { runLocalCli } from './local-supabase.mjs';

const imported = parse(fs.readFileSync('.env.import.local', 'utf8'));
const url = imported.SUPABASE_URL;
const state = JSON.parse(runLocalCli(['status', '--output-format', 'json']));
assert.equal(state.runtime, 'native');
assert.equal(url, state.env.API_URL, 'Acceptance must target this local native stack.');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname));
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-rating-version': '2' } } };
const service = createClient(url, imported.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, state.env.ANON_KEY, options);
const passed = [];

function data(result) {
  assert.equal(result.error, null, result.error?.message);
  return result.data;
}
function pass(name) { passed.push(name); console.log(`PASS ${name}`); }

let credentials;
if (fs.existsSync('.env.test.local')) {
  credentials = parse(fs.readFileSync('.env.test.local', 'utf8'));
  assert.equal(credentials.TEST_SUPABASE_URL, url);
} else {
  credentials = { TEST_SUPABASE_URL: url };
  const stamp = Date.now();
  for (const role of ['AUTHOR', 'OTHER', 'ADMIN']) {
    credentials[`TEST_${role}_EMAIL`] = `upc-${role.toLowerCase()}-${stamp}@example.test`;
    credentials[`TEST_${role}_PASSWORD`] = `Upc-${randomBytes(18).toString('hex')}!`;
    data(await service.auth.admin.createUser({
      email: credentials[`TEST_${role}_EMAIL`], password: credentials[`TEST_${role}_PASSWORD`],
      email_confirm: true, user_metadata: { nickname: `本机验收${role}`, college: '化学化工学院' },
    }));
  }
  fs.writeFileSync('.env.test.local', '# Local test accounts only. Git ignored.\n'
    + Object.entries(credentials).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n',
  { mode: 0o600 });
}

const actors = {};
for (const role of ['AUTHOR', 'OTHER', 'ADMIN']) {
  const client = createClient(url, state.env.ANON_KEY, options);
  const signed = data(await client.auth.signInWithPassword({
    email: credentials[`TEST_${role}_EMAIL`], password: credentials[`TEST_${role}_PASSWORD`],
  }));
  actors[role] = { client, user: signed.user };
  assert.ok(signed.user.email_confirmed_at);
  assert.equal(signed.user.user_metadata.campus, undefined);
}
const { AUTHOR: author, OTHER: other, ADMIN: admin } = actors;
data(await service.from('admin_users').upsert({ email: credentials.TEST_ADMIN_EMAIL,
  role: 'super_admin', nickname: '本机验收管理员', is_active: true }, { onConflict: 'email' }));
pass('three confirmed accounts sign in with the public key and real user sessions');

for (const table of ['reviews', 'user_profiles', 'point_transactions', 'admin_users']) {
  assert.ok((await anon.from(table).select('*').limit(1)).error, `anonymous ${table}`);
}
assert.ok((await other.client.from('admin_users').insert({ email: other.user.email, role: 'super_admin' })).error);
assert.ok((await other.client.from('user_profiles').update({ points: 999 }).eq('id', other.user.id)).error);
assert.deepEqual(data(await other.client.from('user_profiles').select('id').eq('id', author.user.id)), []);
pass('anonymous private tables, self-promotion, point changes and cross-user profiles are refused');

// Remove only reviews left by an interrupted run of this local test account.
const previous = data(await admin.client.from('reviews').select('id')
  .eq('user_id', author.user.id).like('id', 'local-acceptance-%'));
for (const item of previous) data(await admin.client.from('reviews').delete().eq('id', item.id));

const teacher = data(await anon.from('teachers').select('id,name,review_count,overall_score')
  .eq('review_count', 0).order('id').limit(1).single());
const offering = data(await anon.from('course_offerings').select('teacher_id,course_id,term_id')
  .eq('teacher_id', teacher.id).limit(1).single());
const term = data(await anon.from('terms').select('*').eq('id', offering.term_id).single());
const row = {
  id: `local-acceptance-${randomUUID()}`, ...offering, year_term: term.year_term,
  user_id: author.user.id, status: 'pending', rating_version: 2,
  attendance_strictness: 5, grading_leniency: 4, effort_matters: 4,
  workload_difficulty: 4, approachability: 5, teaching_quality: 5,
  comment: '本机真实 Supabase 权限验收；完成后删除测试评价。', author_nickname: '本机验收作者',
};
const points = async () => data(await author.client.from('user_profiles').select('points')
  .eq('id', author.user.id).single()).points;
const before = await points();
const createdIds = [];
try {
  data(await author.client.from('reviews').insert(row));
  createdIds.push(row.id);
  assert.equal(data(await author.client.from('reviews').select('id').eq('id', row.id)).length, 1);
  assert.deepEqual(data(await other.client.from('reviews').select('id').eq('id', row.id)), []);
  assert.deepEqual(data(await anon.from('review_feed').select('*').eq('id', row.id)), []);
  assert.ok((await other.client.rpc('approve_review', { p_review_id: row.id })).error);
  assert.deepEqual(data(await other.client.from('reviews').update({ comment: 'forbidden' }).eq('id', row.id).select('id')), []);
  const offeredIds = new Set(data(await anon.from('course_offerings').select('course_id')
    .eq('teacher_id', teacher.id)).map((item) => item.course_id));
  const unmatched = data(await anon.from('courses').select('id')).find((item) => !offeredIds.has(item.id));
  assert.ok(unmatched);
  assert.ok((await author.client.from('reviews').insert({ ...row,
    id: `invalid-${randomUUID()}`, course_id: unmatched.id })).error);
  pass('real pending review is private; another user cannot edit or approve; unmatched offering is rejected');

  assert.equal(data(await admin.client.rpc('approve_review', { p_review_id: row.id })).success, true);
  assert.equal(await points(), before + 20);
  data(await admin.client.rpc('approve_review', { p_review_id: row.id }));
  assert.equal(await points(), before + 20);
  const feed = data(await anon.from('review_feed').select('*').eq('id', row.id).single());
  for (const privateField of ['user_id', 'reviewer_id', 'reject_reason', 'reviewed_at']) {
    assert.equal(Object.hasOwn(feed, privateField), false);
  }
  assert.deepEqual(data(await other.client.from('reviews').select('id').eq('id', row.id)), []);
  assert.deepEqual(data(await author.client.from('reviews').delete().eq('id', row.id).select('id')), []);
  pass('admin approval makes the safe feed public and awards exactly 20 points once');

  for (const liked of [true, true, false]) {
    const result = data(await other.client.rpc('set_review_like', { p_review_id: row.id, p_liked: liked }));
    assert.equal(result.likes, liked ? 1 : 0);
    assert.equal(result.liked, liked);
  }
  assert.equal(await points(), before + 20);
  pass('another user likes, repeats and unlikes with stable counts and author points');

  const secondId = `local-acceptance-${randomUUID()}`;
  data(await author.client.from('reviews').insert({ ...row, id: secondId }));
  createdIds.push(secondId);
  data(await admin.client.rpc('reject_review', { p_review_id: secondId, p_reason: '请补充课堂体验' }));
  assert.equal(data(await author.client.from('reviews').select('status').eq('id', secondId).single()).status, 'rejected');
  assert.deepEqual(data(await other.client.from('reviews').select('id').eq('id', secondId)), []);
  data(await author.client.from('reviews').update({ comment: '已补充课堂体验', status: 'pending', reject_reason: null })
    .eq('id', secondId));
  assert.equal(data(await author.client.from('reviews').select('status').eq('id', secondId).single()).status, 'pending');
  data(await admin.client.rpc('approve_review', { p_review_id: secondId }));
  assert.equal(await points(), before + 40);
  pass('rejected review can be edited by its author, resubmitted and approved');
} finally {
  for (const id of createdIds) {
    assert.equal(data(await admin.client.from('reviews').delete().eq('id', id).select('id')).length, 1);
  }
}
const cleared = data(await anon.from('teachers').select('*').eq('id', teacher.id).single());
assert.equal(cleared.review_count, 0);
for (const field of ['overall_score', 'attendance_strictness', 'grading_leniency', 'effort_matters',
  'workload_difficulty', 'approachability', 'teaching_quality']) assert.equal(cleared[field], null, field);
pass('deleting the last approved reviews clears all teacher scores');

const firstCheckin = data(await author.client.rpc('handle_daily_checkin'))[0];
const secondCheckin = data(await author.client.rpc('handle_daily_checkin'))[0];
assert.equal(secondCheckin.already_checked_in, true);
assert.equal(secondCheckin.points, firstCheckin.points);
pass('daily check-in is idempotent through a real authenticated RPC');

const report = { testedAt: new Date().toISOString(), environment: 'local-native-supabase',
  api: url, cloudAccepted: false, passed, teacher: teacher.name,
  credentialsFile: '.env.test.local', temporaryReviewsRemoved: true };
fs.mkdirSync('temp/supabase-local', { recursive: true });
fs.writeFileSync('temp/supabase-local/acceptance.json', JSON.stringify(report, null, 2) + '\n');
console.log(`${passed.length} real local Supabase checks passed; account credentials are in .env.test.local.`);
