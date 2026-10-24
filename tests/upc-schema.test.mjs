import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const schema = () => fs.readFileSync(new URL('../supabase_schema.sql', import.meta.url), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/upc-import-sample.json', import.meta.url), 'utf8'),
);
const checksum = 'a'.repeat(64);

const STUDENT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const ADMIN = '00000000-0000-0000-0000-000000000003';
const DELETED = '00000000-0000-0000-0000-000000000004';
const SESSION_STUDENT = '60000000-0000-0000-0000-000000000001';
const SESSION_OTHER = '60000000-0000-0000-0000-000000000002';
const SESSION_ADMIN = '60000000-0000-0000-0000-000000000003';
const SESSION_BY_USER = {
  [STUDENT]: SESSION_STUDENT,
  [OTHER]: SESSION_OTHER,
  [ADMIN]: SESSION_ADMIN,
};
const TERM = '30000000-0000-0000-0000-000000000001';
const COURSE = '40000000-0000-0000-0000-000000000001';
const COLLEGE = '10000000-0000-0000-0000-000000000001';
const TEACHER = 'upc:fixture-teacher-001';

async function createDB() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, email_confirmed_at TIMESTAMPTZ, email_change TEXT);
    CREATE TABLE auth.sessions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, created_at TIMESTAMPTZ DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  `);
  await db.exec(schema());
  await db.exec(`
    INSERT INTO auth.users VALUES
      ('${STUDENT}', 'student@s.upc.edu.cn', now(), NULL),
      ('${OTHER}', 'other@s.upc.edu.cn', now(), NULL),
      ('${ADMIN}', 'reviewer@s.upc.edu.cn', now(), NULL);
    INSERT INTO auth.sessions(id, user_id) VALUES
      ('${SESSION_STUDENT}', '${STUDENT}'),
      ('${SESSION_OTHER}', '${OTHER}'),
      ('${SESSION_ADMIN}', '${ADMIN}');
    INSERT INTO public.admin_users(user_id, email, role)
      VALUES ('${ADMIN}', 'reviewer@s.upc.edu.cn', 'super_admin');
    UPDATE private.upc_security_settings SET value = '0'::jsonb WHERE key = 'review_rate_seconds';
    UPDATE private.upc_security_settings SET value = '1'::jsonb WHERE key = 'min_independent_reviews';
    INSERT INTO public.terms(id, code, year_term, is_current) VALUES ('${TERM}', 'test-term-1', '测试学期', true);
    INSERT INTO public.courses(id, code, name, college_id)
      SELECT '${COURSE}', 'TEST-MATH-101', '测试高等数学', id FROM public.colleges WHERE code = 'upc-12';
    INSERT INTO public.teachers(id, source_id, name, title, college_id, campus)
      SELECT '${TEACHER}', 'fixture-teacher-001', '测试教师甲', '教授', id, '唐岛湾校区'
      FROM public.colleges WHERE code = 'upc-12';
    INSERT INTO public.course_offerings(teacher_id, course_id, term_id)
      VALUES ('${TEACHER}', '${COURSE}', '${TERM}');
  `);
  return db;
}

async function asRoleWithAal(db, role, uid, aal, sql, sessionId = SESSION_BY_USER[uid] || '') {
  await db.exec(`SET ROLE ${role};`);
  try {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);
      SELECT set_config('request.jwt.claims', '{"sub":"${uid || ''}","aal":"${aal}","session_id":"${sessionId}"}', false);
      SELECT set_config('request.headers', '{"x-rating-version":"2"}', false);
    `);
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function asRole(db, role, uid, sql) {
  const aal = role === 'authenticated' && uid === ADMIN ? 'aal2' : 'aal1';
  return asRoleWithAal(db, role, uid, aal, sql);
}

async function asServiceRole(db, sql) {
  await db.exec('SET ROLE service_role;');
  try {
    await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

const insertReview = (id = 'review-1', status = 'pending', user = STUDENT, ratingVersion = 2, course = COURSE) => `
  INSERT INTO public.reviews(
    id, teacher_id, course_id, term_id, year_term, rating_version,
    attendance_strictness, grading_leniency, effort_matters,
    workload_difficulty, approachability, teaching_quality,
    author_nickname, user_id, status
  ) VALUES (
    '${id}', '${TEACHER}', '${course}', '${TERM}', '测试学期', ${ratingVersion},
    5, 4, 4, 4, 5, 5, '匿名石大学子', '${user}', '${status}'
  )`;

test('administrator and governance incremental patches stay aligned with source policy', () => {
  const owner = fs.readFileSync(new URL('../supabase/upgrades/20261024-owner-admin-policy.sql', import.meta.url), 'utf8');
  const boundary = fs.readFileSync(new URL('../supabase/upgrades/20261024-governance-boundary.sql', import.meta.url), 'utf8');
  const correction = fs.readFileSync(new URL('../supabase/upgrades/20261024-governance-correction-closure.sql', import.meta.url), 'utf8');
  assert.match(owner, /private\.upc_is_admin_email/);
  assert.match(owner, /@gmail\.com/);
  assert.match(owner, /ON CONFLICT \(user_id\) WHERE user_id IS NOT NULL DO UPDATE/);
  assert.doesNotMatch(owner, /upc_is_staff_email/);
  assert.match(boundary, /status <> 'withdrawn'/);
  assert.match(boundary, /auth\.uid\(\)::text = NEW\.user_id/);
  assert.match(boundary, /DROP INDEX IF EXISTS public\.reviews_business_key_uidx/);
  assert.match(correction, /private\.upc_data_corrections/);
  assert.match(correction, /private\.upc_correction_pins/);
  assert.match(correction, /apply_governance_correction/);
  assert.match(correction, /record_admin_mfa_recovery/);
  assert.match(correction, /GRANT EXECUTE ON FUNCTION public\.record_admin_mfa_recovery[\s\S]*TO service_role/);
  assert.match(correction, /DELETE FROM auth\.sessions/);
  assert.match(correction, /protectedFields/);
  assert.match(correction, /protectedRelations/);
  assert.match(correction, /拒绝自动删除或转移/);
  assert.doesNotMatch(correction, /DROP TABLE|TRUNCATE|DELETE FROM public\.reviews/);
});

test('clean init has sixteen UPC colleges plus the independent training center', async () => {
  const db = await createDB();
  try {
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.colleges')).rows[0].n, 17);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.colleges WHERE code='upc-17' AND name='石油工业训练中心'")).rows[0].n, 1);
    const rules = (await db.query('SELECT action_code, points_delta FROM public.point_rules ORDER BY action_code')).rows;
    assert.deepEqual(rules.map((row) => row.action_code), ['daily_checkin', 'new_user_welcome', 'review_approved']);
    assert.equal(rules.some((row) => row.action_code === 'ai_question'), false);
    assert.equal((await db.query("SELECT to_regclass('public.notices') AS t")).rows[0].t, null);
    assert.equal((await db.query("SELECT to_regclass('public.document_chunks') AS t")).rows[0].t, null);
    assert.equal((await db.query("SELECT to_regclass('public.review_feed') AS t")).rows[0].t, 'review_feed');
  } finally {
    await db.close();
  }
});

test('review insert, privacy boundary, approval, points and idempotent re-approval', async () => {
  const db = await createDB();
  try {
    await asRole(db, 'authenticated', STUDENT, insertReview('review-1'));
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='review-1'")).rows[0].status, 'pending');

    // The author can read the pending row; another student cannot.
    assert.equal((await asRole(db, 'authenticated', STUDENT, "SELECT count(*)::int AS n FROM public.reviews WHERE id='review-1'")).rows[0].n, 1);
    assert.equal((await asRole(db, 'authenticated', OTHER, "SELECT count(*)::int AS n FROM public.reviews WHERE id='review-1'")).rows[0].n, 0);
    assert.equal((await asRole(db, 'anon', '', "SELECT count(*)::int AS n FROM public.review_feed")).rows[0].n, 0);
    assert.equal((await db.query("SELECT has_table_privilege('anon','public.reviews','SELECT') AS p")).rows[0].p, false);

    // Students cannot approve or alter balances.
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, "SELECT public.approve_review('review-1')"),
      /无审核权限/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, `UPDATE public.user_profiles SET points=999 WHERE id='${STUDENT}'`),
      /permission denied|row-level security/i,
    );

    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('review-1')");
    const approved = (await db.query("SELECT status, reviewer_id FROM public.reviews WHERE id='review-1'")).rows[0];
    assert.equal(approved.status, 'approved');
    assert.ok(approved.reviewer_id);
    assert.equal((await db.query(`SELECT points FROM public.user_profiles WHERE id='${STUDENT}'`)).rows[0].points, 120);
    assert.equal((await db.query("SELECT review_count FROM public.teachers WHERE id='" + TEACHER + "'")).rows[0].review_count, 1);
    assert.equal(Number((await db.query("SELECT overall_score FROM public.teachers WHERE id='" + TEACHER + "'")).rows[0].overall_score), 4.5);

    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('review-1')");
    assert.equal((await db.query(`SELECT points FROM public.user_profiles WHERE id='${STUDENT}'`)).rows[0].points, 120);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.point_transactions WHERE related_review_id='review-1'")).rows[0].n, 1);

    const feedColumns = (await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='review_feed'",
    )).rows.map((row) => row.column_name);
    for (const privateField of ['user_id', 'reviewer_id', 'reject_reason', 'reviewed_at']) {
      assert.equal(feedColumns.includes(privateField), false, `${privateField} must not be public`);
    }
    const feed = await asRole(db, 'anon', '', "SELECT id, course_name, teacher_name, likes FROM public.review_feed");
    assert.equal(feed.rows[0].id, 'review-1');
    assert.equal(feed.rows[0].course_name, '测试高等数学');
    assert.equal(feed.rows[0].teacher_name, '测试教师甲');
  } finally {
    await db.close();
  }
});

test('approval rolls back when the reward rule is disabled', async () => {
  const db = await createDB();
  try {
    await asRole(db, 'authenticated', STUDENT, insertReview('review-no-reward'));
    await db.exec("UPDATE public.point_rules SET is_active=false WHERE action_code='review_approved'");
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('review-no-reward')"),
      /评价奖励规则不可用/,
    );
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='review-no-reward'")).rows[0].status, 'pending');
    assert.equal((await db.query(`SELECT points FROM public.user_profiles WHERE id='${STUDENT}'`)).rows[0].points, 100);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.point_transactions WHERE related_review_id='review-no-reward'")).rows[0].n, 0);

    await db.exec("UPDATE public.point_rules SET is_active=true WHERE action_code='review_approved'");
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('review-no-reward')");
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='review-no-reward'")).rows[0].status, 'approved');
    assert.equal((await db.query(`SELECT points FROM public.user_profiles WHERE id='${STUDENT}'`)).rows[0].points, 120);
  } finally {
    await db.close();
  }
});

test('reject, author re-edit, last-review score clearing and like idempotency', async () => {
  const db = await createDB();
  try {
    await asRole(db, 'authenticated', STUDENT, insertReview('review-1'));
    await asRole(db, 'authenticated', ADMIN, "SELECT public.reject_review('review-1', '请补充具体课程体验')");
    assert.equal((await db.query("SELECT status, reject_reason FROM public.reviews WHERE id='review-1'")).rows[0].status, 'rejected');

    await asRole(db, 'authenticated', STUDENT, `
      UPDATE public.reviews
      SET attendance_strictness=4.5, status='pending', reject_reason=NULL, rating_version=2
      WHERE id='review-1'
    `);
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='review-1'")).rows[0].status, 'pending');

    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('review-1')");
    const liked = await asRole(db, 'authenticated', STUDENT, "SELECT public.set_review_like('review-1', true) AS result");
    assert.equal(liked.rows[0].result.teacher_id, TEACHER);
    await asRole(db, 'authenticated', STUDENT, "SELECT public.set_review_like('review-1', true)");
    assert.equal((await db.query("SELECT likes FROM public.reviews WHERE id='review-1'")).rows[0].likes, 1);
    await asRole(db, 'authenticated', STUDENT, "SELECT public.set_review_like('review-1', false)");
    assert.equal((await db.query("SELECT likes FROM public.reviews WHERE id='review-1'")).rows[0].likes, 0);

    // Deleting the only approved review clears all cached ratings.
    await db.exec("DELETE FROM public.reviews WHERE id='review-1'");
    const teacher = (await db.query(`SELECT * FROM public.teachers WHERE id='${TEACHER}'`)).rows[0];
    assert.equal(teacher.review_count, 0);
    assert.equal(teacher.overall_score, null);
    assert.equal(teacher.attendance_strictness, null);
    assert.equal(teacher.teaching_quality, null);
  } finally {
    await db.close();
  }
});

test('rating v1, out-of-range values and courses without an offering are rejected', async () => {
  const db = await createDB();
  try {
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-v1', 'pending', STUDENT, 1)),
      /评分规则已更新/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-bad', 'pending').replace('5, 4, 4, 4, 5, 5', '6, 4, 4, 4, 5, 5')),
      /4.0 到 5.0/,
    );
    // The column is NUMERIC (not NUMERIC(3,1)); the trigger must see 4.15 and
    // reject it instead of silently storing 4.2.
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-precision').replace('5, 4, 4, 4, 5, 5', '4.15, 4, 4, 4, 5, 5')),
      /最多一位小数/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-low').replace('5, 4, 4, 4, 5, 5', '3.9, 4, 4, 4, 5, 5')),
      /4.0 到 5.0/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-high').replace('5, 4, 4, 4, 5, 5', '5.1, 4, 4, 4, 5, 5')),
      /4.0 到 5.0/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('review-null').replace('5, 4, 4, 4, 5, 5', 'NULL, 4, 4, 4, 5, 5')),
      /六项评分均为必填/,
    );
    await asRole(db, 'authenticated', STUDENT, insertReview('review-boundaries')
      .replace('5, 4, 4, 4, 5, 5', '4.0, 5.0, 4.1, 4.9, 5, 4'));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.reviews WHERE id='review-boundaries'")).rows[0].n, 1);
    // Historical 1–5 records must remain readable after the new-submission rule.
    await db.exec(`
      INSERT INTO public.reviews(
        id, teacher_id, course_id, term_id, year_term, rating_version,
        attendance_strictness, grading_leniency, effort_matters,
        workload_difficulty, approachability, teaching_quality,
        comment, author_nickname, user_id, is_historical_migrated, status
      ) VALUES (
        'review-legacy', '${TEACHER}', '${COURSE}', '${TERM}', '测试学期', 2,
        1.0, 2.0, 3.0, 4.0, 5.0, 1.0,
        '旧评价文字', '匿名石大学子', NULL, true, 'approved'
      )
    `);
    assert.equal((await db.query("SELECT attendance_strictness::text AS s FROM public.reviews WHERE id='review-legacy'")).rows[0].s, '1.0');

    await db.exec(`
      INSERT INTO public.courses(id, code, name, college_id)
      SELECT '40000000-0000-0000-0000-000000000002', 'TEST-NO-OFFERING', '无开课关系课程', id
      FROM public.colleges WHERE code = 'upc-12';
    `);
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview(
        'review-no-offering', 'pending', STUDENT, 2, '40000000-0000-0000-0000-000000000002',
      )),
      /row-level security|违反|policy/i,
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.reviews WHERE id='review-no-offering'")).rows[0].n, 0);

    const first = await asRole(db, 'authenticated', STUDENT, 'SELECT * FROM public.handle_daily_checkin()');
    assert.equal(first.rows[0].already_checked_in, false);
    assert.equal(first.rows[0].points, 105);
    const second = await asRole(db, 'authenticated', STUDENT, 'SELECT * FROM public.handle_daily_checkin()');
    assert.equal(second.rows[0].already_checked_in, true);
    assert.equal(second.rows[0].points, 105);

    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, "SELECT public.spend_points('ai_question')"),
      /积分消费规则不可用/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, "SELECT public.spend_points('not_a_rule')"),
      /积分消费规则不可用/,
    );
  } finally {
    await db.close();
  }
});

test('import is atomic, idempotent, keeps same-name teachers distinct and supports dry run', async () => {
  const db = await createDB();
  try {
    const payload = structuredClone(fixture);
    const first = await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), checksum],
    );
    const firstResult = first.rows[0].result;
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.teachers.inserted, 2);
    assert.equal(firstResult.courses.inserted, 1);
    assert.equal(firstResult.offerings.inserted, 2);

    const teachers = (await db.query("SELECT id, name, title, campus FROM public.teachers WHERE source_id LIKE 'fixture-import-%' ORDER BY source_id")).rows;
    assert.equal(teachers.length, 2);
    assert.equal(teachers[0].name, teachers[1].name);
    assert.notEqual(teachers[0].id, teachers[1].id);
    assert.equal(teachers[1].title, null);
    assert.equal(teachers[1].campus, '古镇口校区');

    const second = await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), checksum],
    );
    const secondResult = second.rows[0].result;
    assert.equal(secondResult.teachers.skipped, 2);
    // The summary counts course rows processed across teachers, so the shared
    // course is reported once per teacher.
    assert.equal(secondResult.courses.skipped, 2);
    assert.equal(secondResult.offerings.skipped, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.teachers')).rows[0].n, 3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n, 2);

    const dry = structuredClone(fixture);
    dry.dataset = 'fixture-dry-run';
    dry.teachers = [{
      sourceId: 'fixture-import-003',
      name: '测试教师乙',
      collegeCode: 'upc-12',
      courses: [{ code: 'TEST-MATH-102', name: '测试线性代数' }],
    }];
    const beforeTeachers = (await db.query('SELECT count(*)::int AS n FROM public.teachers')).rows[0].n;
    const beforeBatches = (await db.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n;
    const dryResult = (await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, true) AS result',
      [JSON.stringify(dry), checksum],
    )).rows[0].result;
    assert.equal(dryResult.dryRun, true);
    assert.equal(dryResult.teachers.inserted, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.teachers')).rows[0].n, beforeTeachers);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n, beforeBatches);

    const bad = structuredClone(fixture);
    bad.teachers = [{ sourceId: 'fixture-bad', name: '坏数据', collegeCode: 'missing-college' }];
    await assert.rejects(
      db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false)', [JSON.stringify(bad), checksum]),
      /学院编码.*不存在/,
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id='fixture-bad'")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('course identity allows same name with different codes and still rejects real conflicts', async () => {
  const db = await createDB();
  try {
    const base = {
      schemaVersion: 1,
      dataset: 'fixture-course-identity',
      source: 'local synthetic course identity fixture',
      term: { code: 'identity-term', name: '身份测试学期', isCurrent: false },
    };
    const payload = teachers => JSON.stringify({ ...base, teachers });
    const run = (teachers, dry = false) => db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, $3) AS result',
      [payload(teachers), checksum, dry],
    );

    const sameNameDifferentCodes = [
      { sourceId: 'identity-a', name: '课程教师甲', collegeCode: 'upc-03',
        courses: [{ code: 'CHM900000001', name: '同名课程' }] },
      { sourceId: 'identity-b', name: '课程教师乙', collegeCode: 'upc-03',
        courses: [{ code: 'CHM900000002', name: '同名课程' }] },
    ];
    const dry = (await run(sameNameDifferentCodes, true)).rows[0].result;
    assert.equal(dry.courses.inserted, 2);
    const first = (await run(sameNameDifferentCodes)).rows[0].result;
    assert.equal(first.courses.inserted, 2);
    const rows = (await db.query("SELECT code, name FROM public.courses WHERE name='同名课程' ORDER BY code")).rows;
    assert.deepEqual(rows.map(r => r.code), ['CHM900000001', 'CHM900000002']);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.course_offerings o JOIN public.courses c ON c.id=o.course_id WHERE c.name='同名课程'")).rows[0].n, 2);
    const second = (await run(sameNameDifferentCodes)).rows[0].result;
    assert.equal(second.courses.skipped, 2);

    // Same code with a different name is a true data conflict, not a version.
    const differentName = [{
      sourceId: 'identity-c', name: '课程教师丙', collegeCode: 'upc-03',
      courses: [{ code: 'CHM900000001', name: '同名课程改名' }],
    }];
    await assert.rejects(run(differentName, true), /已存在名称/);
    await assert.rejects(run(differentName, false), /已存在名称/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id='identity-c'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.courses WHERE name='同名课程'")).rows[0].n, 2);

    // An uncoded name that already has coded rows is ambiguous, not a new course.
    const uncodedAmbiguous = [{
      sourceId: 'identity-d', name: '课程教师丁', collegeCode: 'upc-03',
      courses: [{ name: '同名课程' }],
    }];
    await assert.rejects(run(uncodedAmbiguous, true), /已有编码记录/);
    await assert.rejects(run(uncodedAmbiguous, false), /已有编码记录/);

    // A single uncoded row may later adopt a formal code.
    await run([{ sourceId: 'identity-e', name: '课程教师戊', collegeCode: 'upc-03',
      courses: [{ name: '无编码课程' }] }]);
    const adopted = (await run([{ sourceId: 'identity-f', name: '课程教师己', collegeCode: 'upc-03',
      courses: [{ code: 'CHM900000003', name: '无编码课程' }] }])).rows[0].result;
    assert.equal(adopted.courses.updated, 1);
    assert.equal((await db.query("SELECT code FROM public.courses WHERE name='无编码课程'")).rows[0].code, 'CHM900000003');

    // Course offering unit is independent from the teacher's HR college.
    await run([{ sourceId: 'identity-g', name: '课程教师庚', collegeCode: 'upc-03',
      courses: [{ code: 'CHM900000004', name: '跨学院开课', collegeCode: 'upc-12' }] }]);
    const courseCollege = (await db.query(`
      SELECT c.code, l.code AS college_code
      FROM public.courses c JOIN public.colleges l ON l.id = c.college_id
      WHERE c.code='CHM900000004'
    `)).rows[0];
    assert.deepEqual(courseCollege, { code: 'CHM900000004', college_code: 'upc-12' });
  } finally {
    await db.close();
  }
});

test('the real chemistry timetable dataset imports idempotently with 129 courses and 271 offerings', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/chemistry-2026-2027-1/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const run = dry => db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, $3) AS result',
      [JSON.stringify(payload), digest, dry],
    );
    const first = (await run(false)).rows[0].result;
    assert.equal(first.term.inserted, 1);
    assert.equal(first.teachers.inserted, 136);
    assert.equal(first.courses.inserted, 129);
    assert.equal(first.offerings.inserted, 271);
    // createDB seeds one teacher/course/offering for the review tests.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.teachers')).rows[0].n, 137);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.courses')).rows[0].n, 130);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.course_offerings')).rows[0].n, 272);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.courses c JOIN public.colleges l ON l.id=c.college_id WHERE l.code='upc-03'")).rows[0].n, 129);
    assert.equal((await db.query("SELECT is_current FROM public.terms WHERE code='2026-2027-1'")).rows[0].is_current, false);
    const groups = (await db.query(`
      SELECT name, count(*)::int AS n
      FROM public.courses
      WHERE name IN ('化学工程基础', '大学化学', '有机化学', '专业外语')
      GROUP BY name ORDER BY name
    `)).rows;
    assert.deepEqual(groups, [
      { name: '专业外语', n: 2 },
      { name: '化学工程基础', n: 3 },
      { name: '大学化学', n: 3 },
      { name: '有机化学', n: 3 },
    ]);

    const second = (await run(false)).rows[0].result;
    assert.equal(second.teachers.skipped, 136);
    assert.equal(second.courses.skipped, 271);
    assert.equal(second.offerings.skipped, 271);
    const dry = (await run(true)).rows[0].result;
    assert.equal(dry.dryRun, true);
    assert.equal(dry.teachers.skipped, 136);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.teachers')).rows[0].n, 137);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.courses')).rows[0].n, 130);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.course_offerings')).rows[0].n, 272);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n, 2);
    assert.equal((await db.query(`
      SELECT count(*)::int AS n FROM public.teachers
      WHERE campus IS NOT NULL
        AND college_id = (SELECT id FROM public.colleges WHERE code='upc-03')
    `)).rows[0].n, 0);

    // The imported real teacher/course/term must satisfy the same closed loop as
    // the synthetic fixture: submit, approve, reward, public read, like, delete.
    const realTeacher = (await db.query(
      "SELECT id FROM public.teachers WHERE source_id='cce-c19254-a365302'",
    )).rows[0].id;
    const realOffering = (await db.query(`
      SELECT o.course_id, o.term_id, c.name AS course_name, t.year_term
      FROM public.course_offerings o
      JOIN public.courses c ON c.id=o.course_id
      JOIN public.terms t ON t.id=o.term_id
      WHERE o.teacher_id=$1 LIMIT 1
    `, [realTeacher])).rows[0];
    const beforePoints = (await db.query(
      'SELECT points FROM public.user_profiles WHERE id=$1', [STUDENT],
    )).rows[0].points;
    await asRole(db, 'authenticated', STUDENT, `
      INSERT INTO public.reviews(
        id, teacher_id, course_id, term_id, year_term, rating_version,
        attendance_strictness, grading_leniency, effort_matters,
        workload_difficulty, approachability, teaching_quality,
        author_nickname, user_id, status
      ) VALUES (
        'real-review-1', '${realTeacher}', '${realOffering.course_id}',
        '${realOffering.term_id}', '${realOffering.year_term.replaceAll("'", "''")}', 2,
        5, 4, 4, 4, 5, 5, '匿名石大学子', '${STUDENT}', 'pending'
      )
    `);
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('real-review-1')");
    assert.equal((await db.query(
      'SELECT points FROM public.user_profiles WHERE id=$1', [STUDENT],
    )).rows[0].points, beforePoints + 20);
    assert.equal((await asRole(db, 'anon', '',
      "SELECT count(*)::int AS n FROM public.review_feed WHERE id='real-review-1'")).rows[0].n, 1);
    assert.equal((await asRole(db, 'authenticated', OTHER,
      "SELECT public.set_review_like('real-review-1', true) AS result")).rows[0].result.likes, 1);
    await asRole(db, 'authenticated', OTHER, "SELECT public.set_review_like('real-review-1', false)");
    assert.equal((await db.query("SELECT likes FROM public.reviews WHERE id='real-review-1'")).rows[0].likes, 0);
    await db.exec("DELETE FROM public.reviews WHERE id='real-review-1'");
    assert.equal((await db.query(`SELECT review_count, overall_score FROM public.teachers WHERE id='${realTeacher}'`)).rows[0].review_count, 0);
    assert.equal((await db.query(`SELECT overall_score FROM public.teachers WHERE id='${realTeacher}'`)).rows[0].overall_score, null);
  } finally {
    await db.close();
  }
});

test('the training center batch imports into its independent teaching unit', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/timetables-2026-2027-1/units/engineering-training/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const first = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(first.teachers.inserted, 13);
    assert.equal(first.courses.inserted, 6);
    assert.equal(first.offerings.inserted, 25);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE college_id=(SELECT id FROM public.colleges WHERE code='upc-17')")).rows[0].n, 13);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.courses WHERE college_id=(SELECT id FROM public.colleges WHERE code='upc-17')")).rows[0].n, 6);
    const second = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(second.teachers.inserted, 0);
    assert.equal(second.offerings.inserted, 0);
  } finally {
    await db.close();
  }
});

test('the foreign-language batch imports its verified subset and is idempotent', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/timetables-2026-2027-1/units/foreign-languages/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const first = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(first.teachers.inserted, 100);
    assert.equal(first.courses.inserted, 88);
    assert.equal(first.offerings.inserted, 207);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE college_id=(SELECT id FROM public.colleges WHERE code='upc-13')")).rows[0].n, 100);
    const second = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(second.teachers.inserted, 0);
    assert.equal(second.courses.inserted, 0);
    assert.equal(second.offerings.inserted, 0);
  } finally {
    await db.close();
  }
});

test('same-name official identity reconciliation imports incrementally and idempotently', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/timetables-2026-2027-1/same-name-official-identities/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const first = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(first.teachers.inserted, 12);
    assert.equal(first.courses.inserted, 18);
    assert.equal(first.offerings.inserted, 18);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE name='王艳'")).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id='ocean-c15436-a224962'")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id='computer-c6287-a103926'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id='sci-c6944-a130742'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.course_offerings o JOIN public.courses c ON c.id=o.course_id WHERE c.code IN ('OSI225711020','SCC211021020','SCC211111020')")).rows[0].n, 3);
    const second = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(second.teachers.inserted, 0);
    assert.equal(second.courses.inserted, 0);
    assert.equal(second.offerings.inserted, 0);
  } finally {
    await db.close();
  }
});

test('same-name timetable-unit identities import incrementally and idempotently', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/timetables-2026-2027-1/timetable-identities/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const first = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(first.teachers.inserted, 173);
    assert.equal(first.courses.inserted, 195);
    assert.equal(first.offerings.inserted, 294);
    const tt = (await db.query("SELECT source_id FROM public.teachers WHERE source_id LIKE 'tt-%' ORDER BY source_id")).rows;
    assert.equal(tt.length, 173);
    assert.ok(tt.every(row => row.source_id.startsWith('tt-')));
    const second = (await db.query('SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(payload), digest])).rows[0].result;
    assert.equal(second.teachers.inserted, 0);
    assert.equal(second.courses.inserted, 0);
    assert.equal(second.offerings.inserted, 0);
  } finally {
    await db.close();
  }
});

test('a generated multi-college batch imports atomically and is idempotent', async () => {
  const db = await createDB();
  try {
    const file = new URL('../data/upc/timetables-2026-2027-1/units/earth-science/import.json', import.meta.url);
    const raw = fs.readFileSync(file);
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const run = dry => db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, $3) AS result',
      [JSON.stringify(payload), digest, dry],
    );
    const first = (await run(false)).rows[0].result;
    assert.equal(first.term.inserted, 1);
    assert.equal(first.teachers.inserted, 113);
    assert.equal(first.courses.inserted, 93);
    assert.equal(first.offerings.inserted, 163);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id LIKE 'geori-%'")).rows[0].n, 108);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.teachers WHERE source_id LIKE 'geori-%' AND campus IS NOT NULL")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.courses c JOIN public.colleges l ON l.id=c.college_id WHERE l.code='upc-01'")).rows[0].n, 93);
    const second = (await run(false)).rows[0].result;
    assert.equal(second.teachers.inserted, 0);
    assert.equal(second.offerings.inserted, 0);
    assert.equal(second.offerings.skipped, 163);
  } finally {
    await db.close();
  }
});

test('course-code upgrade refreshes the old importer and imports the real dataset without data loss', async () => {
  const db = await createDB();
  try {
    await db.exec(`
      DROP INDEX public.courses_uncoded_name_college_idx;
      ALTER TABLE public.courses ADD CONSTRAINT courses_name_college_id_key UNIQUE (name, college_id);
      -- Model an initialized database whose import RPC still has its previous
      -- implementation. A DDL-only upgrade must not pass this test.
      CREATE OR REPLACE FUNCTION private.upc_import_dataset_apply(p_payload JSONB, p_checksum TEXT)
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        RAISE EXCEPTION 'stale pre-upgrade importer';
      END $$;
    `);
    const raw = fs.readFileSync(new URL('../data/upc/chemistry-2026-2027-1/import.json', import.meta.url));
    const payload = JSON.parse(raw.toString('utf8'));
    const digest = createHash('sha256').update(raw).digest('hex');
    const run = dry => db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, $3) AS result',
      [JSON.stringify(payload), digest, dry],
    );
    await assert.rejects(run(false), /stale pre-upgrade importer/);
    const upgrade = fs.readFileSync(
      new URL('../supabase/upgrades/20261022-course-code-identity.sql', import.meta.url),
      'utf8',
    );
    await db.exec(upgrade);
    const preview = (await run(true)).rows[0].result;
    assert.equal(preview.dryRun, true);
    assert.equal(preview.courses.inserted, 129);
    assert.equal(preview.offerings.inserted, 271);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.courses')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.import_batches')).rows[0].n, 0);

    const imported = (await run(false)).rows[0].result;
    assert.equal(imported.teachers.inserted, 136);
    assert.equal(imported.courses.inserted, 129);
    assert.equal(imported.offerings.inserted, 271);
    const repeat = (await run(false)).rows[0].result;
    assert.equal(repeat.teachers.skipped, 136);
    assert.equal(repeat.courses.skipped, 271);
    assert.equal(repeat.offerings.skipped, 271);
    await db.exec(upgrade);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.courses')).rows[0].n, 130);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.course_offerings')).rows[0].n, 272);
    await db.exec(`
      INSERT INTO public.courses(id, code, name, college_id)
      SELECT '40000000-0000-0000-0000-000000000099', 'TEST-UPGRADE-002', '测试高等数学', id
      FROM public.colleges WHERE code = 'upc-12';
    `);
    const rows = (await db.query("SELECT code FROM public.courses WHERE name='测试高等数学' ORDER BY code")).rows;
    assert.deepEqual(rows.map(r => r.code), ['TEST-MATH-101', 'TEST-UPGRADE-002']);
    assert.equal((await db.query("SELECT to_regclass('public.courses_uncoded_name_college_idx') AS i")).rows[0].i,
      'courses_uncoded_name_college_idx');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.courses WHERE code IS NULL")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('student email hook and auth.users update guard reject non-student paths', async () => {
  const db = await createDB();
  try {
    const rejected = (await db.query(
      "SELECT public.before_user_created_hook($1::jsonb) AS result",
      [JSON.stringify({ user: { email: 'person@upc.edu.cn' } })],
    )).rows[0].result;
    assert.equal(rejected.error.http_code, 400);
    assert.match(rejected.error.message, /s\.upc\.edu\.cn/);
    const allowed = (await db.query(
      "SELECT public.before_user_created_hook($1::jsonb) AS result",
      [JSON.stringify({ user: { email: 'Alias.Student+lab@s.upc.Edu.Cn' } })],
    )).rows[0].result;
    assert.equal(allowed.user.email, 'Alias.Student+lab@s.upc.Edu.Cn');

    await assert.rejects(
      db.exec("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (gen_random_uuid(),'x@example.test',now())"),
      /s\.upc\.edu\.cn/,
    );
    await assert.rejects(
      db.exec(`UPDATE auth.users SET email='x@example.test' WHERE id='${STUDENT}'`),
      /s\.upc\.edu\.cn/,
    );
    await db.exec('ALTER TABLE auth.users DISABLE TRIGGER upc_guard_auth_email');
    await db.exec(`
      INSERT INTO auth.users(id,email,email_confirmed_at,email_change)
      VALUES ('00000000-0000-0000-0000-000000000099','legacy@example.test',now(),NULL)
    `);
    await db.exec('ALTER TABLE auth.users ENABLE TRIGGER upc_guard_auth_email');
    await assert.rejects(
      db.exec("UPDATE auth.users SET email_change='new@s.upc.edu.cn' WHERE id='00000000-0000-0000-0000-000000000099'"),
      /历史非学生账户/,
    );

    await assert.rejects(
      db.exec("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (gen_random_uuid(),'staff@upc.edu.cn',now())"),
      /受控邀请/,
    );
    await assert.rejects(asRole(db, 'authenticated', ADMIN,
      "SELECT public.create_admin_invite('staff@upc.edu.cn', 2)"), /gmail/);
    await assert.rejects(db.exec("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (gen_random_uuid(),'operator@gmail.com',now())"), /受控邀请/);
    const invite = (await asRole(db, 'authenticated', ADMIN,
      "SELECT public.create_admin_invite('operator@gmail.com', 2) AS result")).rows[0].result;
    assert.equal(invite.success, true);
    const invited = (await db.query(
      "SELECT public.before_user_created_hook($1::jsonb) AS result",
      [JSON.stringify({ user: { email: 'operator@gmail.com' } })],
    )).rows[0].result;
    assert.equal(invited.user.email, 'operator@gmail.com');
    await db.exec("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('00000000-0000-0000-0000-000000000098','operator@gmail.com',now())");
    assert.ok((await db.query("SELECT used_at FROM private.upc_admin_invites WHERE email='operator@gmail.com'")).rows[0].used_at);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.admin_users WHERE user_id='00000000-0000-0000-0000-000000000098'")).rows[0].n, 0);
    await asRole(db, 'authenticated', ADMIN, "SELECT public.set_admin_role('00000000-0000-0000-0000-000000000098','moderator')");
    await asRole(db, 'authenticated', ADMIN, "SELECT public.set_admin_role('00000000-0000-0000-0000-000000000098','admin')");
    assert.equal((await db.query("SELECT role FROM public.admin_users WHERE user_id='00000000-0000-0000-0000-000000000098'")).rows[0].role, 'admin');
    assert.ok((await db.query("SELECT count(*)::int AS n FROM private.upc_admin_audit_log WHERE action='admin_role_set'")).rows[0].n >= 2);

    await db.exec(`
      INSERT INTO public.admin_users(user_id, email, role)
      VALUES ('${OTHER}', 'ordinary@s.upc.edu.cn', 'admin')
    `);
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, "SELECT public.create_admin_invite('owner@gmail.com', 1)"),
      /审核权限|管理员/,
    );
    await assert.rejects(
      asRoleWithAal(db, 'authenticated', OTHER, 'aal2',
        "SELECT public.create_admin_invite('owner@gmail.com', 1)"),
      /超级管理员/,
    );
    await assert.rejects(
      asRoleWithAal(db, 'authenticated', OTHER, 'aal2',
        "SELECT public.set_admin_role('00000000-0000-0000-0000-000000000098','moderator')"),
      /超级管理员/,
    );
    await assert.rejects(
      asRoleWithAal(db, 'authenticated', ADMIN, 'aal1',
        "SELECT public.create_admin_invite('owner@gmail.com', 1)"),
      /AAL2|MFA/,
    );
    await assert.rejects(
      asRoleWithAal(db, 'authenticated', ADMIN, 'aal1',
        "SELECT public.set_admin_role('00000000-0000-0000-0000-000000000098','admin')"),
      /AAL2|MFA/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN,
        `SELECT public.set_admin_role('${ADMIN}','admin')`),
      /gmail/,
    );
    await assert.rejects(
      db.exec("UPDATE auth.users SET email='other@gmail.com' WHERE id='00000000-0000-0000-0000-000000000098'"),
      /历史非学生账户/,
    );
    await db.exec(`
      INSERT INTO private.upc_admin_invites(email, expires_at)
      VALUES ('legacy-admin@upc.edu.cn', now() + interval '1 hour')
    `);
    const legacyInvite = (await db.query(
      "SELECT public.before_user_created_hook($1::jsonb) AS result",
      [JSON.stringify({ user: { email: 'legacy-admin@upc.edu.cn' } })],
    )).rows[0].result;
    assert.equal(legacyInvite.error.http_code, 400);
  } finally {
    await db.close();
  }
});

test('administrators can moderate historical non-student reviews but the legacy author cannot edit ratings', async () => {
  const db = await createDB();
  try {
    const legacy = '00000000-0000-0000-0000-000000000097';
    await db.exec('ALTER TABLE auth.users DISABLE TRIGGER upc_guard_auth_email');
    await db.exec(`INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES ('${legacy}','legacy-owner@example.test',now())`);
    await db.exec('ALTER TABLE auth.users ENABLE TRIGGER upc_guard_auth_email');
    const legacyCourses = [
      '40000000-0000-0000-0000-000000000501',
      '40000000-0000-0000-0000-000000000502',
      '40000000-0000-0000-0000-000000000503',
    ];
    await db.exec(`
      INSERT INTO public.courses(id, code, name, college_id)
        SELECT '${legacyCourses[0]}', 'LEGACY-1', '历史课程一', id FROM public.colleges WHERE code='upc-12';
      INSERT INTO public.courses(id, code, name, college_id)
        SELECT '${legacyCourses[1]}', 'LEGACY-2', '历史课程二', id FROM public.colleges WHERE code='upc-12';
      INSERT INTO public.courses(id, code, name, college_id)
        SELECT '${legacyCourses[2]}', 'LEGACY-3', '历史课程三', id FROM public.colleges WHERE code='upc-12';
      INSERT INTO public.course_offerings(teacher_id, course_id, term_id) VALUES
        ('${TEACHER}', '${legacyCourses[0]}', '${TERM}'),
        ('${TEACHER}', '${legacyCourses[1]}', '${TERM}'),
        ('${TEACHER}', '${legacyCourses[2]}', '${TERM}');
      INSERT INTO public.reviews(
        id, teacher_id, course_id, term_id, year_term, rating_version,
        attendance_strictness, grading_leniency, effort_matters,
        workload_difficulty, approachability, teaching_quality,
        author_nickname, user_id, status, is_historical_migrated
      ) VALUES
        ('legacy-approve', '${TEACHER}', '${legacyCourses[0]}', '${TERM}', '测试学期', 2,
         5, 4, 4, 4, 5, 5, '历史用户', '${legacy}', 'pending', true),
        ('legacy-reject', '${TEACHER}', '${legacyCourses[1]}', '${TERM}', '测试学期', 2,
         5, 4, 4, 4, 5, 5, '历史用户', '${legacy}', 'pending', true),
        ('legacy-edit', '${TEACHER}', '${legacyCourses[2]}', '${TERM}', '测试学期', 2,
         5, 4, 4, 4, 5, 5, '历史用户', '${legacy}', 'pending', true);
    `);
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('legacy-approve')");
    await asRole(db, 'authenticated', ADMIN,
      "SELECT public.reject_review('legacy-reject', '历史记录治理校验')");
    await assert.rejects(
      asRole(db, 'authenticated', legacy,
        "UPDATE public.reviews SET teaching_quality=4.9 WHERE id='legacy-edit'"),
      /row-level security|仅已验证学生邮箱/,
    );
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='legacy-approve'")).rows[0].status, 'approved');
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='legacy-reject'")).rows[0].status, 'rejected');
    assert.equal(Number((await db.query("SELECT teaching_quality FROM public.reviews WHERE id='legacy-edit'")).rows[0].teaching_quality), 5);

    const request = (await asRole(db, 'authenticated', legacy, `
      SELECT public.submit_governance_request(
        'review_withdrawal', '历史账户请求撤回已公开评价并停止公开统计。',
        NULL, 'legacy-approve', NULL, NULL, NULL
      ) AS result
    `)).rows[0].result;
    await asRole(db, 'authenticated', ADMIN,
      `SELECT public.process_governance_request('${request.id}', 'accepted', '已核对历史作者并撤回')`);
    assert.equal((await db.query("SELECT status FROM public.reviews WHERE id='legacy-approve'")).rows[0].status, 'withdrawn');
  } finally {
    await db.close();
  }
});

test('rate limit, governance withdrawal and five-review sample threshold are enforced', async () => {
  const db = await createDB();
  try {
    await db.exec(`
      UPDATE private.upc_security_settings SET value='0'::jsonb WHERE key='review_rate_seconds';
      UPDATE private.upc_security_settings SET value='5'::jsonb WHERE key='min_independent_reviews';
      INSERT INTO public.courses(id, code, name, college_id)
        SELECT '40000000-0000-0000-0000-000000000002', 'SECOND-COURSE', '第二门课', id
        FROM public.colleges WHERE code='upc-12';
      INSERT INTO public.course_offerings(teacher_id, course_id, term_id)
        VALUES ('${TEACHER}', '40000000-0000-0000-0000-000000000002', '${TERM}');
    `);

    await asRole(db, 'authenticated', STUDENT, insertReview('rate-1'));
    await db.exec("UPDATE private.upc_security_settings SET value='60'::jsonb WHERE key='review_rate_seconds'");
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('rate-2', 'pending', STUDENT, 2, '40000000-0000-0000-0000-000000000002')),
      /提交过于频繁/,
    );
    await db.exec("UPDATE private.upc_security_settings SET value='0'::jsonb WHERE key='review_rate_seconds'");
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('duplicate-id')),
      /duplicate key|unique/i,
    );

    const thresholdUsers = [1, 2, 3, 4, 5].map((n) => `00000000-0000-0000-0000-00000000010${n}`);
    for (const [index, user] of thresholdUsers.entries()) {
      await db.exec(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('${user}','th${index}@s.upc.edu.cn',now())`);
    }
    await db.exec(`
      INSERT INTO public.courses(id, code, name, college_id)
        SELECT '40000000-0000-0000-0000-000000000003', 'THRESHOLD-COURSE', '门槛课程', id
        FROM public.colleges WHERE code='upc-12';
      INSERT INTO public.course_offerings(teacher_id, course_id, term_id)
        VALUES ('${TEACHER}', '40000000-0000-0000-0000-000000000003', '${TERM}');
    `);
    for (let i = 0; i < 4; i += 1) {
      await asRole(db, 'authenticated', thresholdUsers[i],
        insertReview(`threshold-${i}`, 'pending', thresholdUsers[i], 2, '40000000-0000-0000-0000-000000000003'));
      await asRole(db, 'authenticated', ADMIN, `SELECT public.approve_review('threshold-${i}')`);
    }
    assert.equal((await asRole(db, 'anon', '', "SELECT count(*)::int AS n FROM public.review_feed WHERE course_id='40000000-0000-0000-0000-000000000003'")).rows[0].n, 0);
    assert.equal((await db.query(`SELECT rating_public FROM public.teachers WHERE id='${TEACHER}'`)).rows[0].rating_public, false);
    const feedColumns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='review_feed'")).rows.map((row) => row.column_name);
    assert.equal(feedColumns.includes('comment'), false);
    assert.equal(feedColumns.includes('created_at'), false);
    assert.equal(feedColumns.includes('created_week'), true);

    await asRole(db, 'authenticated', thresholdUsers[4],
      insertReview('threshold-4', 'pending', thresholdUsers[4], 2, '40000000-0000-0000-0000-000000000003'));
    const risk = (await db.query("SELECT risk_flags FROM public.reviews WHERE id='threshold-4'")).rows[0].risk_flags;
    assert.ok(Array.isArray(risk) && risk.includes('offering_burst'));
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('threshold-4')");
    assert.equal((await asRole(db, 'anon', '', "SELECT count(*)::int AS n FROM public.review_feed WHERE course_id='40000000-0000-0000-0000-000000000003'")).rows[0].n, 5);
    assert.equal((await db.query(`SELECT rating_public FROM public.teachers WHERE id='${TEACHER}'`)).rows[0].rating_public, true);

    const request = (await asRole(db, 'authenticated', thresholdUsers[0], `
      SELECT public.submit_governance_request(
        'review_withdrawal', '本人已毕业，希望撤回这条公开评价以降低可识别风险。',
        NULL, 'threshold-0', NULL, NULL, NULL
      ) AS result
    `)).rows[0].result;
    assert.equal(request.success, true);
    assert.equal((await asRole(db, 'authenticated', thresholdUsers[1],
      `SELECT count(*)::int AS n FROM public.governance_requests WHERE id='${request.id}'`)).rows[0].n, 0);
    await asRole(db, 'authenticated', ADMIN,
      `SELECT public.process_governance_request('${request.id}', 'accepted', '已核对作者身份并撤回')`);
    assert.equal((await db.query(`SELECT status, is_public FROM public.reviews WHERE id='threshold-0'`)).rows[0].status, 'withdrawn');
    assert.equal((await db.query(`SELECT is_public FROM public.reviews WHERE id='threshold-0'`)).rows[0].is_public, false);
    assert.equal((await asRole(db, 'anon', '', "SELECT count(*)::int AS n FROM public.review_feed WHERE course_id='40000000-0000-0000-0000-000000000003'")).rows[0].n, 0);
    assert.equal((await db.query(`SELECT rating_public FROM public.teachers WHERE id='${TEACHER}'`)).rows[0].rating_public, false);

    await asRole(db, 'authenticated', thresholdUsers[0],
      insertReview('threshold-0-resubmit', 'pending', thresholdUsers[0], 2, '40000000-0000-0000-0000-000000000003'));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.reviews WHERE id IN ('threshold-0','threshold-0-resubmit')")).rows[0].n, 2);
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('threshold-0-resubmit')");
    assert.equal((await asRole(db, 'anon', '', "SELECT count(*)::int AS n FROM public.review_feed WHERE course_id='40000000-0000-0000-0000-000000000003'")).rows[0].n, 5);
  } finally {
    await db.close();
  }
});

test('backfill rebuild removes stale pre-migration scores below the threshold', async () => {
  const db = await createDB();
  try {
    await db.exec("UPDATE private.upc_security_settings SET value='5'::jsonb WHERE key='min_independent_reviews'");
    await asRole(db, 'authenticated', STUDENT, insertReview('backfill-review', 'pending'));
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('backfill-review')");
    await db.exec(`UPDATE public.teachers SET overall_score=4.5, rating_public=true,
      independent_reviewer_count=1 WHERE id='${TEACHER}'`);
    await db.exec('SELECT private.upc_rebuild_public_ratings()');
    const teacher = (await db.query(`SELECT overall_score, rating_public, independent_reviewer_count
      FROM public.teachers WHERE id='${TEACHER}'`)).rows[0];
    assert.equal(teacher.overall_score, null);
    assert.equal(teacher.rating_public, false);
    assert.equal(teacher.independent_reviewer_count, 1);
  } finally {
    await db.close();
  }
});

test('governance boundary patch releases withdrawn keys without deleting history', async () => {
  const db = await createDB();
  try {
    await db.exec(`
      DROP INDEX public.reviews_business_key_uidx;
      CREATE UNIQUE INDEX reviews_business_key_uidx
        ON public.reviews (user_id, teacher_id, course_id, term_id)
        WHERE user_id IS NOT NULL;
    `);
    await asRole(db, 'authenticated', STUDENT, insertReview('boundary-old'));
    await asRole(db, 'authenticated', ADMIN, "SELECT public.approve_review('boundary-old')");
    const request = (await asRole(db, 'authenticated', STUDENT, `
      SELECT public.submit_governance_request(
        'review_withdrawal', '合成测试：撤回后应释放业务键，不删除历史行。',
        NULL, 'boundary-old', NULL, NULL, NULL
      ) AS result
    `)).rows[0].result;
    await asRole(db, 'authenticated', ADMIN,
      `SELECT public.process_governance_request('${request.id}', 'accepted', '合成测试通过')`);
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT, insertReview('boundary-new')),
      /duplicate key|unique/i,
    );
    await db.exec(fs.readFileSync(new URL('../supabase/upgrades/20261024-governance-boundary.sql', import.meta.url), 'utf8'));
    await asRole(db, 'authenticated', STUDENT, insertReview('boundary-new'));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.reviews WHERE id IN ('boundary-old','boundary-new')")).rows[0].n, 2);
    const predicate = (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='reviews_business_key_uidx'")).rows[0].indexdef;
    assert.match(predicate, /status.*withdrawn/);
  } finally {
    await db.close();
  }
});

test('accepted corrections write back, archive diffs, reject conflicts and survive re-import', async () => {
  const db = await createDB();
  try {
    const teacherRequest = (await asRole(db, 'authenticated', STUDENT, `
      SELECT public.submit_governance_request(
        'teacher_profile_correction', '学院官网人事页面显示姓名和职称需要纠正。',
        '${TEACHER}', NULL, NULL, NULL, '学院官网教师名录截图已线下核对'
      ) AS result
    `)).rows[0].result;

    // A status change alone is not a completed correction.
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN,
        `SELECT public.process_governance_request('${teacherRequest.id}', 'accepted', '仅修改状态')`),
      /实际写回/,
    );
    await assert.rejects(
      asRoleWithAal(db, 'authenticated', ADMIN, 'aal1',
        `SELECT public.apply_governance_correction('${teacherRequest.id}',
          '{"teacher":{"name":"测试教师乙"}}'::jsonb, '学院官网教师名录截图已线下核对')`),
      /AAL2/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', STUDENT,
        `SELECT public.apply_governance_correction('${teacherRequest.id}',
          '{"teacher":{"name":"测试教师乙"}}'::jsonb, '学院官网教师名录截图已线下核对')`),
      /无审核权限/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN,
        `SELECT public.apply_governance_correction('${teacherRequest.id}',
          '{"teacher":{"name":"测试教师甲"}}'::jsonb, '学院官网教师名录截图已线下核对')`),
      /未检测到实际变更/,
    );

    const teacherApplied = (await asRole(db, 'authenticated', ADMIN, `
      SELECT public.apply_governance_correction('${teacherRequest.id}',
        '{"teacher":{"name":"测试教师乙","title":"副教授","campus":"古镇口校区"}}'::jsonb,
        '学院官网教师名录 2026-10-24') AS result
    `)).rows[0].result;
    assert.equal(teacherApplied.success, true);
    assert.equal(teacherApplied.status, 'completed');
    assert.deepEqual([...teacherApplied.changed_fields].sort(), ['campus', 'name', 'title']);
    const teacher = (await db.query(`SELECT name, title, campus FROM public.teachers WHERE id='${TEACHER}'`)).rows[0];
    assert.deepEqual(teacher, { name: '测试教师乙', title: '副教授', campus: '古镇口校区' });
    const requestRow = (await db.query(`SELECT status, resolved_at FROM public.governance_requests WHERE id='${teacherRequest.id}'`)).rows[0];
    assert.equal(requestRow.status, 'completed');
    assert.ok(requestRow.resolved_at);
    const ledger = (await db.query(`SELECT target_type, target_id, action, before_data, after_data, source_basis,
      request_id FROM private.upc_data_corrections WHERE request_id='${teacherRequest.id}'`)).rows[0];
    assert.equal(ledger.target_type, 'teacher');
    assert.equal(ledger.target_id, TEACHER);
    assert.equal(ledger.action, 'update');
    assert.equal(ledger.before_data.name, '测试教师甲');
    assert.equal(ledger.after_data.name, '测试教师乙');
    assert.match(ledger.source_basis, /教师名录/);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM private.upc_correction_pins
      WHERE target_table='teachers' AND target_id='${TEACHER}'`)).rows[0].n, 3);
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN,
        `SELECT public.apply_governance_correction('${teacherRequest.id}',
          '{"teacher":{"name":"测试教师丙"}}'::jsonb, '学院官网教师名录 2026-10-24')`),
      /已写回/,
    );

    const reimport = {
      schemaVersion: 1,
      dataset: 'correction-reimport',
      source: 'synthetic re-import for automated tests only',
      term: { code: 'test-term-1', name: '测试学期', isCurrent: true },
      teachers: [{
        sourceId: 'fixture-teacher-001', name: '测试教师甲', title: '教授',
        collegeCode: 'upc-12', campus: '唐岛湾校区',
        courses: [{ code: 'TEST-MATH-101', name: '测试高等数学' }],
      }],
    };
    const teacherImport = (await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(reimport), 'b'.repeat(64)],
    )).rows[0].result;
    assert.ok(teacherImport.teachers.protectedFields >= 1);
    assert.deepEqual(
      (await db.query(`SELECT name, title, campus FROM public.teachers WHERE id='${TEACHER}'`)).rows[0],
      { name: '测试教师乙', title: '副教授', campus: '古镇口校区' },
    );

    // Course corrections update the catalog and prevent an old-name re-import
    // from being rejected or silently undoing the corrected name.
    const courseRequest = (await asRole(db, 'authenticated', STUDENT, `
      SELECT public.submit_governance_request(
        'course_offering_correction', '教务系统课程名称需要按官方全称纠正。',
        NULL, NULL, '${COURSE}', NULL, '教务处课程目录'
      ) AS result
    `)).rows[0].result;
    await asRole(db, 'authenticated', ADMIN, `
      SELECT public.apply_governance_correction('${courseRequest.id}',
        '{"course":{"name":"测试高等数学（纠正）"}}'::jsonb, '教务处课程目录 2026-10-24')`);
    assert.equal((await db.query(`SELECT name FROM public.courses WHERE id='${COURSE}'`)).rows[0].name, '测试高等数学（纠正）');
    const courseImport = (await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(reimport), 'c'.repeat(64)],
    )).rows[0].result;
    assert.ok(courseImport.courses.protectedFields >= 1);
    assert.equal((await db.query(`SELECT name FROM public.courses WHERE id='${COURSE}'`)).rows[0].name, '测试高等数学（纠正）');

    // Removing an offering with review references must fail closed.
    await asRole(db, 'authenticated', STUDENT, insertReview('correction-review'));
    const offeringId = (await db.query(`SELECT id FROM public.course_offerings
      WHERE teacher_id='${TEACHER}' AND course_id='${COURSE}' AND term_id='${TERM}'`)).rows[0].id;
    const offeringRequest = (await asRole(db, 'authenticated', STUDENT, `
      SELECT public.submit_governance_request(
        'course_offering_correction', '该授课关系为误录，请核对后删除。',
        NULL, NULL, NULL, '${offeringId}', '教务处开课目录'
      ) AS result
    `)).rows[0].result;
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN, `
        SELECT public.apply_governance_correction('${offeringRequest.id}',
          '{"offering":{"action":"remove"}}'::jsonb, '教务处开课目录 2026-10-24')`),
      /仍关联 1 条评价.*拒绝自动删除或转移/,
    );
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.course_offerings WHERE id='${offeringId}'`)).rows[0].n, 1);

    await db.exec("DELETE FROM public.reviews WHERE id='correction-review'");
    const offeringApplied = (await asRole(db, 'authenticated', ADMIN, `
      SELECT public.apply_governance_correction('${offeringRequest.id}',
        '{"offering":{"action":"remove"}}'::jsonb, '教务处开课目录 2026-10-24') AS result
    `)).rows[0].result;
    assert.equal(offeringApplied.action, 'remove');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.course_offerings WHERE id='${offeringId}'`)).rows[0].n, 0);
    const protectedImport = (await db.query(
      'SELECT public.import_upc_dataset($1::jsonb, $2, false) AS result',
      [JSON.stringify(reimport), 'd'.repeat(64)],
    )).rows[0].result;
    assert.ok(protectedImport.offerings.protectedRelations >= 1);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.course_offerings
      WHERE teacher_id='${TEACHER}' AND course_id='${COURSE}' AND term_id='${TERM}'`)).rows[0].n, 0);

    // Rejection keeps the catalog unchanged and still records a resolution.
    const rejectRequest = (await asRole(db, 'authenticated', STUDENT, `
      SELECT public.submit_governance_request(
        'teacher_profile_correction', '提交一项最终被驳回的资料纠错申请。',
        '${TEACHER}', NULL, NULL, NULL, '无有效来源')
      AS result
    `)).rows[0].result;
    await asRole(db, 'authenticated', ADMIN,
      `SELECT public.process_governance_request('${rejectRequest.id}', 'rejected', '来源不足，驳回')`);
    assert.equal((await db.query(`SELECT status FROM public.governance_requests WHERE id='${rejectRequest.id}'`)).rows[0].status, 'rejected');
    assert.equal((await db.query(`SELECT name FROM public.teachers WHERE id='${TEACHER}'`)).rows[0].name, '测试教师乙');
  } finally {
    await db.close();
  }
});

test('account deletion detaches correction evidence without undoing the correction', async () => {
  const db = await createDB();
  try {
    await db.exec(`INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES ('${DELETED}','deleted@s.upc.edu.cn',now())`);
    const request = (await asRole(db, 'authenticated', DELETED, `
      SELECT public.submit_governance_request(
        'teacher_profile_correction', '合成测试：账户注销前提交的教师资料纠错。',
        '${TEACHER}', NULL, NULL, NULL, '学院官网教师名录'
      ) AS result
    `)).rows[0].result;
    await asRole(db, 'authenticated', ADMIN, `
      SELECT public.apply_governance_correction('${request.id}',
        '{"teacher":{"title":"兼职教授"}}'::jsonb, '学院官网教师名录 2026-10-24')`);
    // The deletion utility removes the requester's governance request. The
    // correction ledger and pin survive because they are catalog evidence, not
    // applicant content, and the request link is set to NULL by the FK.
    await db.exec(`DELETE FROM public.governance_requests WHERE id='${request.id}'`);
    const ledger = (await db.query(`SELECT request_id, after_data
      FROM private.upc_data_corrections WHERE target_id='${TEACHER}'`)).rows[0];
    assert.equal(ledger.request_id, null);
    assert.equal(ledger.after_data.title, '兼职教授');
    const pin = (await db.query(`SELECT request_id, corrected_value
      FROM private.upc_correction_pins
      WHERE target_table='teachers' AND target_id='${TEACHER}' AND field_name='title'`)).rows[0];
    assert.equal(pin.request_id, null);
    assert.equal(pin.corrected_value, '兼职教授');
    assert.equal((await db.query(`SELECT title FROM public.teachers WHERE id='${TEACHER}'`)).rows[0].title, '兼职教授');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.governance_requests WHERE id='${request.id}'`)).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('controlled administrator MFA recovery is service-role-only and audited', async () => {
  const db = await createDB();
  try {
    const result = await asServiceRole(db, `
      SELECT public.record_admin_mfa_recovery(
        '${ADMIN}', '隔离演练操作员',
        '合成管理员丢失 TOTP 设备，线下身份核验完成',
        ARRAY['factor-1']::text[]
      ) AS result
    `);
    assert.equal(result.rows[0].result.success, true);
    assert.equal(result.rows[0].result.sessions_revoked, 1);
    assert.equal(result.rows[0].result.role, 'super_admin');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM auth.sessions WHERE user_id='${ADMIN}'`)).rows[0].n, 0);
    const audit = (await db.query(`SELECT action, reason, metadata
      FROM private.upc_admin_audit_log WHERE action='admin_mfa_recovery'`)).rows[0];
    assert.equal(audit.reason, '合成管理员丢失 TOTP 设备，线下身份核验完成');
    assert.equal(audit.metadata.operator, '隔离演练操作员');
    assert.deepEqual(audit.metadata.factor_ids, ['factor-1']);
    assert.equal(audit.metadata.sessions_revoked, 1);
    assert.equal((await db.query(`SELECT role FROM public.admin_users WHERE user_id='${ADMIN}'`)).rows[0].role, 'super_admin');
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN, `
        SELECT public.record_admin_mfa_recovery(
          '${ADMIN}', 'administrator', 'administrator must not self-recover an account',
          ARRAY['factor-1']::text[]
        )`),
      /permission denied|仅受控后台服务/,
    );
    await assert.rejects(
      asServiceRole(db, `
        SELECT public.record_admin_mfa_recovery(
          '${STUDENT}', '隔离演练操作员',
          '普通用户不能通过恢复接口提升权限，必须继续拒绝',
          ARRAY['factor-1']::text[]
        )`),
      /目标不是已登记管理员/,
    );
  } finally {
    await db.close();
  }
});

test('a revoked AAL2 session cannot act and a new session restores admin access', async () => {
  const db = await createDB();
  try {
    const before = await asRole(db, 'authenticated', ADMIN, `
      SELECT public.approve_review('missing-review') AS r
    `);
    assert.equal(before.rows[0].r.success, false);
    assert.match(before.rows[0].r.message, /评价不存在/);

    await db.exec(`DELETE FROM auth.sessions WHERE id = '${SESSION_ADMIN}'`);
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN, `SELECT public.approve_review('missing-review')`),
      /无审核权限/,
    );
    await assert.rejects(
      asRole(db, 'authenticated', ADMIN, `
        SELECT public.create_admin_invite('stale-${Date.now()}@gmail.com', 1)
      `),
      /无审核权限/,
    );
    const staleStatus = await asRole(db, 'authenticated', ADMIN, `
      SELECT public.get_my_admin_status() AS status
    `);
    assert.equal(staleStatus.rows[0].status.is_admin, false);
    const staleQueue = await asRole(db, 'authenticated', ADMIN, `
      SELECT count(*)::int AS n FROM public.admin_review_queue
    `);
    assert.equal(staleQueue.rows[0].n, 0);

    const NEW_SESSION = '60000000-0000-0000-0000-000000000004';
    await db.exec(`INSERT INTO auth.sessions(id, user_id) VALUES ('${NEW_SESSION}', '${ADMIN}')`);
    const freshStatus = await asRoleWithAal(db, 'authenticated', ADMIN, 'aal2', `
      SELECT public.get_my_admin_status() AS status
    `, NEW_SESSION);
    assert.equal(freshStatus.rows[0].status.is_admin, true);
    const freshInvite = await asRoleWithAal(db, 'authenticated', ADMIN, 'aal2', `
      SELECT public.create_admin_invite('fresh-${Date.now()}@gmail.com', 1) AS result
    `, NEW_SESSION);
    assert.equal(freshInvite.rows[0].result.success, true);
  } finally {
    await db.close();
  }
});

test('a second current term is rejected by the database', async () => {
  const db = await createDB();
  try {
    await assert.rejects(
      db.exec("INSERT INTO public.terms(code, year_term, is_current) VALUES ('term-2', '另一个当前学期', true)"),
      /duplicate key|unique/i,
    );
  } finally {
    await db.close();
  }
});


test('teacher scoring appeals are retired without deleting historical requests', async () => {
  const db = await createDB();
  try {
    assert.equal((await db.query("SELECT to_regprocedure('public.create_proxy_teacher_appeal(text,text,text)') AS f")).rows[0].f, null);
    await assert.rejects(db.exec(`INSERT INTO public.governance_requests(request_type,statement)
      VALUES ('teacher_appeal','retired request must never be created')`), /不支持的申请类型/);
    // Simulate an existing installation with a historical appeal and its old CHECK.
    await db.exec(`ALTER TABLE public.governance_requests DROP CONSTRAINT governance_requests_request_type_check;
      ALTER TABLE public.governance_requests DISABLE TRIGGER governance_request_type_guard;
      INSERT INTO public.governance_requests(id,request_type,statement)
      VALUES ('90000000-0000-0000-0000-000000000099','teacher_appeal','historical request must remain intact');
      ALTER TABLE public.governance_requests ENABLE TRIGGER governance_request_type_guard;`);
    const patch = fs.readFileSync(new URL('../supabase/upgrades/20261024-remove-teacher-appeal.sql', import.meta.url), 'utf8');
    await db.exec(patch);
    await db.exec(patch);
    await db.exec("UPDATE public.governance_requests SET status='completed' WHERE id='90000000-0000-0000-0000-000000000099'");
    assert.equal((await db.query("SELECT statement FROM public.governance_requests WHERE id='90000000-0000-0000-0000-000000000099'")).rows[0].statement, 'historical request must remain intact');
    await assert.rejects(db.exec("INSERT INTO public.governance_requests(request_type,statement) VALUES ('teacher_appeal','still refused on upgraded installations')"), /不支持的申请类型/);
  } finally { await db.close(); }
});
