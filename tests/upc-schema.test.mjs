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
const TERM = '30000000-0000-0000-0000-000000000001';
const COURSE = '40000000-0000-0000-0000-000000000001';
const COLLEGE = '10000000-0000-0000-0000-000000000001';
const TEACHER = 'upc:fixture-teacher-001';

async function createDB() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, email_confirmed_at TIMESTAMPTZ);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  `);
  await db.exec(schema());
  await db.exec(`
    INSERT INTO auth.users VALUES
      ('${STUDENT}', 'student@example.test', now()),
      ('${OTHER}', 'other@example.test', now()),
      ('${ADMIN}', 'reviewer@example.test', now());
    INSERT INTO public.admin_users(email, role) VALUES ('reviewer@example.test', 'super_admin');
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

async function asRole(db, role, uid, sql) {
  await db.exec(`SET ROLE ${role};`);
  try {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);
      SELECT set_config('request.headers', '{"x-rating-version":"2"}', false);
    `);
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
    comment, author_nickname, user_id, status
  ) VALUES (
    '${id}', '${TEACHER}', '${course}', '${TERM}', '测试学期', ${ratingVersion},
    5, 4, 4, 4, 5, 5, '真实课堂体验', '匿名石大学子', '${user}', '${status}'
  )`;

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
      SET comment='补充后的具体体验', status='pending', reject_reason=NULL, rating_version=2
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
        comment, author_nickname, user_id, status
      ) VALUES (
        'real-review-1', '${realTeacher}', '${realOffering.course_id}',
        '${realOffering.term_id}', '${realOffering.year_term.replaceAll("'", "''")}', 2,
        5, 4, 4, 4, 5, 5, '真实批次闭环评价', '匿名石大学子', '${STUDENT}', 'pending'
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
