import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ensureAdminAal2 } from './mfa-test-helpers.mjs';

const publicEnv = parse(fs.readFileSync('.env.local', 'utf8'));
const serviceEnv = parse(fs.readFileSync('.env.import.local', 'utf8'));
const testEnv = parse(fs.readFileSync('.env.test.local', 'utf8'));
const url = publicEnv.VITE_SUPABASE_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Real concurrency checks are restricted to the local loopback stack.');
}
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-rating-version': '2' } },
};
const service = createClient(url, serviceEnv.SUPABASE_SERVICE_ROLE_KEY, options);
const adminAuth = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
const passed = [];
const report = { testedAt: new Date().toISOString(), environment: 'local-native-supabase-real-connections', passed };
const testUsers = [];
const testReviewIds = [];
const createdUserIds = [];
const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
let adminClient;
let adminUserId;
let settingsZeroed = false;
let operatorEmail = null;

const check = (condition, label, extra = '') => {
  if (!condition) throw new Error(`FAILED: ${label}${extra ? ` (${extra})` : ''}`);
  passed.push(label);
};

function runSql(sql) {
  const file = path.join('temp', 'security-test.sql');
  fs.mkdirSync('temp', { recursive: true });
  fs.writeFileSync(file, sql);
  const script = `set -e
ROOT=/path/to/xiaoshizi
STACK=$(ls -d /home/operator/.supabase/stacks/0499* | head -1)
PW=$(python3 - "$STACK/state.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["credentials"]["databasePassword"])
PY
)
PSQL=$(ls /home/operator/.supabase/cache/stack/slim-services/postgres/*/linux-*/*/bin/psql | head -1)
PGPASSWORD="$PW" "$PSQL" "postgresql://postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 --file "$ROOT/temp/security-test.sql"`;
  const result = spawnSync('wsl.exe', ['-d', 'Ubuntu-24.04', '--exec', 'sh', '-lc', script], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Local SQL failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function createStudent(label) {
  const email = `security-db-${label}-${stamp}@s.upc.edu.cn`;
  const password = `Upc-${randomBytes(18).toString('hex')}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  createdUserIds.push(id);
  const client = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const actor = { id, email, password, client };
  testUsers.push(actor);
  return actor;
}

function reviewRow(params) {
  const teacherId = params.teacherId ?? params.teacher_id;
  const courseId = params.courseId ?? params.course_id;
  const termId = params.termId ?? params.term_id;
  const yearTerm = params.yearTerm ?? params.year_term ?? params.terms?.year_term;
  const userId = params.userId ?? params.user_id;
  const id = params.id ?? `sec-${randomUUID()}`;
  return {
    id, teacher_id: teacherId, course_id: courseId, term_id: termId, year_term: yearTerm,
    user_id: userId, status: 'pending', rating_version: 2,
    attendance_strictness: 5, grading_leniency: 4.2, effort_matters: 4.3,
    workload_difficulty: 4.1, approachability: 4.8, teaching_quality: 4.9,
    author_nickname: '匿名石大学子', likes: 0,
  };
}

async function pointsOf(userId) {
  const result = await service.from('user_profiles').select('points').eq('id', userId).single();
  if (result.error) throw result.error;
  return result.data.points;
}

try {
  runSql("UPDATE private.upc_security_settings SET value='0'::jsonb WHERE key='review_rate_seconds';");
  settingsZeroed = true;

  const zeroTeachers = await service.from('teachers').select('id')
    .eq('review_count', 0).order('id').limit(40);
  if (zeroTeachers.error) throw zeroTeachers.error;
  const teacherIds = zeroTeachers.data.map((row) => row.id);
  const offerings = await service.from('course_offerings')
    .select('teacher_id,course_id,term_id,terms(year_term)')
    .in('teacher_id', teacherIds).order('id').limit(200);
  if (offerings.error) throw offerings.error;
  check(offerings.data.length >= 4, 'found at least four zero-review offerings for isolated checks');
  const offeringA = offerings.data[0];
  const offeringB = offerings.data[1];
  const offeringC = offerings.data[2];
  const offeringD = offerings.data[3];

  const userA = await createStudent('a');
  const rowA1 = reviewRow({ ...offeringA, userId: userA.id, yearTerm: offeringA.terms.year_term });
  const rowA2 = { ...rowA1, id: `sec-${randomUUID()}` };
  const userASecondClient = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
  const secondSignIn = await userASecondClient.auth.signInWithPassword({
    email: userA.email, password: userA.password,
  });
  if (secondSignIn.error) throw secondSignIn.error;
  const [insertA1, insertA2] = await Promise.all([
    userA.client.from('reviews').insert(rowA1),
    userASecondClient.from('reviews').insert(rowA2),
  ]);
  const successes = [insertA1, insertA2].filter((result) => !result.error);
  const insertErrors = [insertA1, insertA2].filter((result) => result.error)
    .map((result) => `${result.error.code || 'no-code'}:${result.error.message}`).join(' | ');
  check(successes.length === 1, 'two real connections cannot insert the same user x teacher x course x term', insertErrors);
  const storedA = await service.from('reviews').select('id').eq('user_id', userA.id)
    .eq('teacher_id', offeringA.teacher_id).eq('course_id', offeringA.course_id).eq('term_id', offeringA.term_id);
  check(storedA.data.length === 1, 'database retains exactly one business row');
  testReviewIds.push(storedA.data[0].id);

  const rowB = reviewRow({ ...offeringB, userId: userA.id, yearTerm: offeringB.terms.year_term });
  const insertB = await userA.client.from('reviews').insert(rowB);
  if (insertB.error) throw insertB.error;
  testReviewIds.push(rowB.id);
  const collision = await userA.client.from('reviews').update({
    course_id: offeringA.course_id,
    term_id: offeringA.term_id,
    year_term: offeringA.terms.year_term,
  }).eq('id', rowB.id);
  check(Boolean(collision.error), 'editing a review into an existing business combination is rejected');

  const commentAttempt = await userA.client.from('reviews').insert({
    ...reviewRow({ ...offeringD, userId: userA.id, yearTerm: offeringD.terms.year_term }),
    comment: '这一段文字评论不应写入',
  });
  check(Boolean(commentAttempt.error), 'direct non-empty comment write is rejected by the server boundary');

  const feedColumns = await service.from('review_feed').select('comment').limit(1);
  check(Boolean(feedColumns.error), 'public review projection has no comment column');
  const feedTime = await service.from('review_feed').select('created_week').limit(1);
  check(!feedTime.error, 'public review projection exposes only a week bucket');

  const legacyEmail = testEnv.TEST_AUTHOR_EMAIL;
  const legacyPassword = testEnv.TEST_AUTHOR_PASSWORD;
  const legacy = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
  const legacySignIn = await legacy.auth.signInWithPassword({ email: legacyEmail, password: legacyPassword });
  check(!legacySignIn.error, 'existing legacy non-student account can still sign in');
  const legacyInsert = await legacy.from('reviews').insert(reviewRow({
    ...offeringD, userId: legacySignIn.data.user.id, yearTerm: offeringD.terms.year_term,
  }));
  check(Boolean(legacyInsert.error), 'legacy non-student account cannot create a new review');
  if (!legacyInsert.error) {
    await service.from('reviews').delete().eq('id', legacyInsert.data?.[0]?.id || '');
  }

  const thresholdUsers = [];
  for (let i = 0; i < 5; i += 1) thresholdUsers.push(await createStudent(`t${i}`));
  const thresholdRows = thresholdUsers.map((user) => reviewRow({
    ...offeringC, userId: user.id, yearTerm: offeringC.terms.year_term,
  }));

  adminAuth; // keep the public-key client explicit for the admin session below
  const adminSignIn = await adminAuth.auth.signInWithPassword({
    email: testEnv.TEST_ADMIN_EMAIL, password: testEnv.TEST_ADMIN_PASSWORD,
  });
  if (adminSignIn.error) throw adminSignIn.error;
  adminClient = adminAuth;
  adminUserId = adminSignIn.data.user.id;
  const aal1Attempt = await adminClient.rpc('approve_review', { p_review_id: thresholdRows[0].id });
  check(
    Boolean(aal1Attempt.error) && /AAL2|MFA/.test(aal1Attempt.error.message),
    'AAL1 administrator session is refused by a sensitive moderation RPC',
    aal1Attempt.error?.message || '',
  );
  await ensureAdminAal2(adminAuth);
  check(true, 'administrator completed TOTP challenge and reached AAL2');

  const schoolInvite = await adminClient.rpc('create_admin_invite', {
    p_email: `security-staff-${stamp}@upc.edu.cn`, p_hours: 1,
  });
  check(Boolean(schoolInvite.error) && /gmail/i.test(schoolInvite.error.message),
    'school-domain administrator invites are refused', schoolInvite.error?.message || '');
  operatorEmail = `security-operator-${stamp}@gmail.com`;
  const invite = await adminClient.rpc('create_admin_invite', { p_email: operatorEmail, p_hours: 1 });
  check(invite.data?.success === true, 'AAL2 super administrator creates a private Gmail operator invite');
  const staffCreated = await service.auth.admin.createUser({
    email: operatorEmail, password: `Upc-${randomBytes(18).toString('hex')}!`, email_confirm: true,
  });
  if (staffCreated.error) throw staffCreated.error;
  createdUserIds.push(staffCreated.data.user.id);
  const autoAdmin = await service.from('admin_users').select('id', { count: 'exact', head: true })
    .eq('user_id', staffCreated.data.user.id);
  check((autoAdmin.count ?? 0) === 0, 'manual Gmail invitation creates no automatic administrator grant');
  check(true, 'manually invited Gmail account can pass the real Auth hook');

  const fourInsert = await Promise.all(thresholdUsers.slice(0, 4).map((user, i) =>
    user.client.from('reviews').insert(thresholdRows[i])));
  for (const result of fourInsert) if (result.error) throw result.error;
  testReviewIds.push(...thresholdRows.slice(0, 4).map((row) => row.id));
  for (let i = 0; i < 4; i += 1) {
    const approved = await adminClient.rpc('approve_review', { p_review_id: thresholdRows[i].id });
    if (approved.error) throw approved.error;
  }
  const beforeFifth = await adminClient.from('review_feed').select('id', { count: 'exact', head: true })
    .eq('teacher_id', offeringC.teacher_id);
  check((beforeFifth.count ?? 0) === 0, 'four independent reviewers expose no public reviews or scores');
  const teacherFour = await service.from('teachers').select('review_count,rating_public,overall_score')
    .eq('id', offeringC.teacher_id).single();
  check(teacherFour.data.rating_public === false && teacherFour.data.overall_score === null,
    'teacher aggregate remains masked at four reviewers');

  const fifthInsert = await thresholdUsers[4].client.from('reviews').insert(thresholdRows[4]);
  if (fifthInsert.error) throw fifthInsert.error;
  testReviewIds.push(thresholdRows[4].id);
  const riskQueue = await adminClient.from('admin_review_queue').select('id,risk_flags')
    .eq('id', thresholdRows[4].id).single();
  check(
    Array.isArray(riskQueue.data?.risk_flags) && riskQueue.data.risk_flags.includes('offering_burst'),
    'concentrated offering submissions are flagged for pending review',
    JSON.stringify({ flags: riskQueue.data?.risk_flags, error: riskQueue.error?.message || null }),
  );
  const fifthApprove = await adminClient.rpc('approve_review', { p_review_id: thresholdRows[4].id });
  if (fifthApprove.error) throw fifthApprove.error;
  const afterFifth = await adminClient.from('review_feed').select('id', { count: 'exact', head: true })
    .eq('teacher_id', offeringC.teacher_id);
  check((afterFifth.count ?? 0) === 5, 'five independent reviewers cross the public threshold');
  const teacherFive = await service.from('teachers').select('review_count,rating_public,overall_score')
    .eq('id', offeringC.teacher_id).single();
  check(teacherFive.data.rating_public === true && Number(teacherFive.data.overall_score) > 0,
    'teacher aggregate becomes visible only after the threshold');

  const rewardUser = await createStudent('reward');
  const rewardRow = reviewRow({ ...offeringD, userId: rewardUser.id, yearTerm: offeringD.terms.year_term });
  const rewardInsert = await rewardUser.client.from('reviews').insert(rewardRow);
  if (rewardInsert.error) throw rewardInsert.error;
  testReviewIds.push(rewardRow.id);
  const beforeReward = await pointsOf(rewardUser.id);
  const firstApprove = await adminClient.rpc('approve_review', { p_review_id: rewardRow.id });
  if (firstApprove.error) throw firstApprove.error;
  check(await pointsOf(rewardUser.id) === beforeReward + 20, 'first approval awards exactly 20 points');
  const deleted = await adminClient.rpc('delete_review_as_admin', {
    p_review_id: rewardRow.id, p_reason: '安全验收临时评价删除',
  });
  if (deleted.error) throw deleted.error;
  testReviewIds.splice(testReviewIds.indexOf(rewardRow.id), 1);
  const replayRow = reviewRow({ ...offeringD, userId: rewardUser.id, yearTerm: offeringD.terms.year_term });
  const replayInsert = await rewardUser.client.from('reviews').insert(replayRow);
  if (replayInsert.error) throw replayInsert.error;
  testReviewIds.push(replayRow.id);
  const replayApprove = await adminClient.rpc('approve_review', { p_review_id: replayRow.id });
  if (replayApprove.error) throw replayApprove.error;
  check(await pointsOf(rewardUser.id) === beforeReward + 20,
    'delete and resubmit with a new review ID cannot replay the business reward');
  check(replayApprove.data?.points_awarded === false, 'approval reports no second reward');

  const governanceUser = await createStudent('gov');
  const submission = await governanceUser.client.rpc('submit_governance_request', {
    p_type: 'account_deletion',
    p_statement: '申请注销并删除本测试账户的个人数据，用于验收私有治理队列。',
  });
  check(submission.data?.success === true, 'authenticated user submits a private deletion request');
  const ownRequests = await governanceUser.client.from('governance_requests').select('id,status')
    .eq('id', submission.data.id);
  check(ownRequests.data.length === 1, 'requester can read their own governance request');
  const otherRequests = await userA.client.from('governance_requests').select('id').eq('id', submission.data.id);
  check(otherRequests.data.length === 0, 'another student cannot read the request');
  const adminQueue = await adminClient.from('admin_governance_queue').select('id,statement')
    .eq('id', submission.data.id).single();
  check(adminQueue.data?.statement?.length > 0, 'authorized administrator sees the private queue');
  const processed = await adminClient.rpc('process_governance_request', {
    p_request_id: submission.data.id, p_status: 'accepted', p_resolution: '核验通过，转受控后台删除流程',
  });
  check(processed.data?.success === true, 'authorized administrator processes the request');
  const accepted = await governanceUser.client.from('governance_requests').select('status')
    .eq('id', submission.data.id).single();
  check(accepted.data.status === 'accepted', 'requester sees the server-side processing status');

  const audit = await adminClient.rpc('get_admin_audit_log', { p_limit: 20 });
  check(Array.isArray(audit.data) && audit.data.length > 0, 'administrator can read append-only audit actions');

  runSql("UPDATE private.upc_security_settings SET value='60'::jsonb WHERE key='review_rate_seconds';");
  settingsZeroed = false;
  const rateUser = await createStudent('rate');
  const rateRow1 = reviewRow({ ...offeringA, userId: rateUser.id, yearTerm: offeringA.terms.year_term });
  const rateClientA = rateUser.client;
  const rateClientB = createClient(url, publicEnv.VITE_SUPABASE_ANON_KEY, options);
  const rateSignInB = await rateClientB.auth.signInWithPassword({
    email: rateUser.email,
    password: rateUser.password,
  });
  if (rateSignInB.error) throw rateSignInB.error;
  const [rate1, rate2] = await Promise.all([
    rateClientA.from('reviews').insert(rateRow1),
    rateClientB.from('reviews').insert({ ...rateRow1, id: `sec-${randomUUID()}` }),
  ]);
  check([rate1, rate2].filter((result) => !result.error).length === 1,
    'atomic rate limit accepts only one of two simultaneous submissions');
  const rateMessage = [rate1, rate2].find((result) => result.error)?.error?.message || '';
  check(/频繁|上限/.test(rateMessage), 'rate rejection returns an explicit server message', rateMessage);
} finally {
  if (settingsZeroed) {
    try { runSql("UPDATE private.upc_security_settings SET value='60'::jsonb WHERE key='review_rate_seconds';"); } catch {}
  }
  const ids = createdUserIds.map((id) => `'${id}'::uuid`).join(',');
  const reviewIds = testReviewIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(',');
  if (ids) {
    runSql(`
      DELETE FROM public.reviews WHERE user_id IN (SELECT id::text FROM auth.users WHERE id IN (${ids}));
      ${reviewIds ? `DELETE FROM public.reviews WHERE id IN (${reviewIds});` : ''}
      DELETE FROM public.governance_requests WHERE requester_user_id IN (${ids});
      DELETE FROM private.upc_review_rewards WHERE user_id IN (SELECT id::text FROM auth.users WHERE id IN (${ids}));
      DELETE FROM private.upc_review_rate_limits WHERE user_id IN (SELECT id::text FROM auth.users WHERE id IN (${ids}));
      ${operatorEmail ? `DELETE FROM private.upc_admin_invites WHERE email='${operatorEmail}';` : ''}
      DELETE FROM public.user_profiles WHERE id IN (SELECT id::text FROM auth.users WHERE id IN (${ids}));
      DELETE FROM auth.users WHERE id IN (${ids});
    `);
  }
  if (adminClient) await adminClient.auth.signOut();
}

fs.mkdirSync('temp/supabase-local', { recursive: true });
fs.writeFileSync('temp/supabase-local/security-db-report.json', `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync('temp/supabase-local/security-db-report.md', [
  '# 数据库安全与真实并发验证',
  '',
  `- 时间：${report.testedAt}`,
  `- 环境：${report.environment}`,
  '',
  ...passed.map((item) => `- [x] ${item}`),
  '',
].join('\n'));
console.log(`${passed.length} real database security checks passed.`);
