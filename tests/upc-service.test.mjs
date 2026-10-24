import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const stripImports = (source) => source.replace(
  /^import[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm,
  '',
);
const serviceSource = stripImports(
  fs.readFileSync(new URL('../src/services/supabaseService.ts', import.meta.url), 'utf8'),
).replace('export const supabaseService =', 'globalThis.service =');
const serviceCompiled = ts.transpileModule(serviceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const ratingsSource = stripImports(
  fs.readFileSync(new URL('../src/lib/ratings.ts', import.meta.url), 'utf8'),
).replaceAll('export ', '');
const ratingsCompiled = ts.transpileModule(ratingsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function setup(options = {}) {
  const tables = {
    teachers: options.teachers || [],
    reviews: options.reviews || [],
    admin_review_queue: options.adminReviews || [],
    review_feed: options.feed || [],
    terms: options.terms || [],
    courses: options.courses || [],
    course_offerings: options.offerings || [],
    user_profiles: options.profiles || [{ id: 'student', points: 37, last_checkin_date: null }],
    point_transactions: options.transactions || [],
    review_likes: options.likes || [],
  };
  const writes = [];
  const calls = [];
  const queries = [];
  const apiCalls = [];

  function match(row, filters) {
    return filters.every(([key, op, value]) => {
      if (op === 'eq') return row[key] === value;
      if (op === 'in') return value.includes(row[key]);
      if (op === 'ilike') return String(row[key] ?? '').toLowerCase().includes(String(value).replaceAll('%', '').toLowerCase());
      return true;
    });
  }

  function builder(table) {
    let mode = 'select';
    let selectOptions = {};
    let insertPayload;
    let updatePayload;
    let filters = [];
    let orders = [];
    let start = 0;
    let end = 999;
    const query = {
      select(_columns, opts = {}) { selectOptions = opts; return query; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return query; },
      update(payload) { mode = 'update'; updatePayload = payload; return query; },
      delete(opts = {}) { mode = 'delete'; selectOptions = opts; return query; },
      eq(key, value) { filters.push([key, 'eq', value]); return query; },
      in(key, values) { filters.push([key, 'in', values]); return query; },
      ilike(key, value) { filters.push([key, 'ilike', value]); return query; },
      or() { return query; },
      not() { return query; },
      abortSignal() { return query; },
      order(key, order = {}) { orders.push([key, order]); return query; },
      range(from, to) { start = from; end = to; return query; },
      maybeSingle() {
        const result = execute();
        return Promise.resolve({ ...result, data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data });
      },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };

    function execute() {
      queries.push({ table, mode, filters, orders, start, end, selectOptions });
      const rows = tables[table] || [];
      if (mode === 'insert') {
        writes.push({ table, method: 'insert', payload: insertPayload });
        if (options.writeError) return { data: null, error: options.writeError, count: null };
        rows.push({ ...insertPayload });
        return { data: null, error: null, count: 1 };
      }
      if (mode === 'update') {
        writes.push({ table, method: 'update', payload: updatePayload });
        const matched = rows.filter((row) => match(row, filters));
        matched.forEach((row) => Object.assign(row, updatePayload));
        return { data: null, error: null, count: matched.length };
      }
      if (mode === 'delete') {
        writes.push({ table, method: 'delete', filters });
        const before = rows.length;
        const remaining = rows.filter((row) => !match(row, filters));
        tables[table] = remaining;
        return { data: null, error: null, count: before - remaining.length };
      }
      let data = rows.filter((row) => match(row, filters));
      for (const [key, order] of [...orders].reverse()) {
        const ascending = order.ascending !== false;
        data = data.sort((a, b) => {
          const av = a[key];
          const bv = b[key];
          if (av == null && bv == null) return 0;
          if (av == null) return order.nullsFirst ? -1 : 1;
          if (bv == null) return order.nullsFirst ? 1 : -1;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      const count = data.length;
      if (selectOptions.head) return { data: null, error: null, count };
      return { data: data.slice(start, end + 1), error: null, count };
    }

    return query;
  }

  const supabase = {
    auth: {
      getUser: async () => options.authError
        ? { data: { user: null }, error: options.authError }
        : { data: { user: options.user ?? {
          id: 'student', email: 'student@s.upc.edu.cn', email_confirmed_at: '2026-10-01T00:00:00Z',
        } }, error: null },
      updateUser: async payload => {
        calls.push({ name: 'updateUser', payload });
        return options.updateError
          ? { data: { user: null }, error: options.updateError }
          : { data: { user: options.user ?? { id: 'student' } }, error: null };
      },
    },
    from: builder,
    async rpc(name, args) {
      calls.push({ name, args });
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (name === 'set_review_like') return { data: { likes: 8, liked: args.p_liked }, error: null };
      if (name === 'handle_daily_checkin') return { data: [{ points: 42, already_checked_in: true }], error: null };
      if (name === 'get_my_admin_status') return { data: { is_admin: false }, error: null };
      return { data: { success: true, message: 'ok' }, error: null };
    },
  };

  const window = options.window;
  const context = {
    supabase,
    window,
    isSupabaseConfigured: options.configured !== false,
    cacheApiEnabled: Boolean(options.cacheEnabled),
    cacheQuery: (value) => new URLSearchParams(Object.entries(value).filter(([, v]) => v !== undefined)).toString(),
    cacheRequest: async (path, request) => {
      apiCalls.push({ path, request });
      if (options.apiError) throw new Error(options.apiError);
      return options.apiResult;
    },
    normalizeRatingRecord: null,
    readRating: null,
    RATING_VERSION: 2,
    validateStudentEmail: (value) => {
      const email = typeof value === 'string' ? value.trim() : '';
      return email.includes('@') && email.split('@').length === 2
        && email.split('@')[1].toLowerCase() === 's.upc.edu.cn'
        ? { ok: true, email }
        : { ok: false, email, message: '仅限 @s.upc.edu.cn 学生邮箱' };
    },
    console: { warn() {}, error() {} },
    setTimeout,
    URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(ratingsCompiled, context);
  vm.runInContext(serviceCompiled, context);
  return { service: context.service, writes, calls, queries, apiCalls, tables };
}

test('password recovery saves a new password and clears the recovery fragment', async () => {
  const replaceCalls = [];
  const f = setup({
    user: { id: 'student', email: 'student@example.test' },
    window: {
      location: { hash: '#access_token=token&type=recovery', pathname: '/', search: '' },
      history: { replaceState: (...args) => replaceCalls.push(args) },
    },
  });
  assert.equal(f.service.hasRecoveryParams(), true);
  await assert.rejects(f.service.updatePassword('123'), /6 位/);
  assert.equal(f.calls.filter(c => c.name === 'updateUser').length, 0);
  const result = await f.service.updatePassword('new-password-123');
  assert.equal(result.user.id, 'student');
  assert.equal(f.calls.find(c => c.name === 'updateUser').payload.password, 'new-password-123');
  assert.equal(replaceCalls.length, 1);
  assert.equal(replaceCalls[0][2], '/');
});

test('unconfigured database fails closed with no mock, local or old-project fallback', async () => {
  const f = setup({ configured: false, teachers: [] });
  await assert.rejects(f.service.getTeachersPage(), /数据库尚未配置/);
  await assert.rejects(f.service.getTerms(), /数据库尚未配置/);
  await assert.rejects(f.service.getCourses(), /数据库尚未配置/);
  const submitted = await f.service.submitReview({
    id: 'r', teacherId: 't', courseId: 'c', yearTerm: '2026', dimensions: {},
  });
  assert.equal(submitted.success, false);
  assert.match(submitted.message, /数据库未配置/);
  assert.equal(f.writes.length, 0);
});

test('public reviews read the safe view and non-public status is refused', async () => {
  const f = setup({ feed: [{
    id: 'r1', teacher_id: 't1', course_id: 'c1', term_id: 'term', year_term: '2026-2027-1',
    course_name: '测试课程', teacher_name: '测试教师', status: 'approved',
    created_at: '2026-10-01T00:00:00Z', likes: 2, rating_version: 2,
    attendance_strictness: 5, grading_leniency: 4, approachability: 5,
  }] });
  const page = await f.service.getReviewsPage({ teacherId: 't1', status: 'approved' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].courseName, '测试课程');
  assert.equal(page.items[0].teacherName, '测试教师');
  assert.equal(page.items[0].termId, 'term');
  assert.equal(f.queries[0].table, 'review_feed');
  await assert.rejects(f.service.getReviewsPage({ status: 'pending' }), /管理员审核接口/);
});

test('admin reviews read the controlled queue and keep moderation filters', async () => {
  const f = setup({ adminReviews: [
    { id: 'pending-1', teacher_id: 't1', course_id: 'c1', term_id: 'term', year_term: '2026', status: 'pending', created_at: '2026-10-01', rating_version: 2 },
    { id: 'approved-1', teacher_id: 't1', course_id: 'c1', term_id: 'term', year_term: '2026', status: 'approved', created_at: '2026-10-02', rating_version: 2 },
  ] });
  const page = await f.service.getAdminReviewsPage({ status: 'pending' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].status, 'pending');
  assert.equal(f.queries[0].table, 'admin_review_queue');
  assert.ok(f.queries[0].filters.some(([key, , value]) => key === 'status' && value === 'pending'));
  assert.equal(Object.hasOwn(page.items[0], 'userEmail'), false);
});

test('submission requires a real term and teacher offering and writes v2 pending data', async () => {
  const f = setup({
    terms: [{ id: 'term', code: '2026-2027-1', year_term: '2026-2027第1学期', is_current: true }],
    offerings: [{ id: 'off', teacher_id: 't1', course_id: 'c1', term_id: 'term' }],
  });
  const review = {
    id: 'review-new', teacherId: 't1', courseId: 'c1', termId: 'term', yearTerm: '2026-2027第1学期',
    dimensions: {
      attendanceStrictness: 5, gradingLeniency: 4.1, effortMatters: 4.2,
      workloadDifficulty: 4.3, approachability: 4.4, teachingQuality: 5,
    },
    comment: undefined, authorNickname: '匿名石大学子', status: 'pending', likes: 99,
  };
  const result = await f.service.submitReview(review);
  assert.equal(result.success, true);
  assert.equal(f.writes.length, 1);
  const payload = f.writes[0].payload;
  assert.equal(payload.term_id, 'term');
  assert.equal(payload.rating_version, 2);
  assert.equal(payload.status, 'pending');
  assert.equal(payload.likes, 0);
  assert.equal(payload.user_id, 'student');
  assert.equal(payload.course_id, 'c1');
  assert.equal(Object.hasOwn(payload, 'comment'), false);
  assert.equal(payload.author_nickname, '匿名石大学子');
  assert.equal(Object.hasOwn(payload, 'created_at'), false);

  const invalid = await f.service.submitReview({ ...review, id: 'review-415',
    dimensions: { ...review.dimensions, attendanceStrictness: 4.15 } });
  assert.equal(invalid.success, false);
  assert.match(invalid.message, /最多一位小数/);

  const missingOffering = setup({
    terms: [{ id: 'term', code: 't', year_term: '学期', is_current: true }],
    offerings: [],
  });
  const rejected = await missingOffering.service.submitReview(review);
  assert.equal(rejected.success, false);
  assert.match(rejected.message, /开课关系/);
  assert.equal(missingOffering.writes.length, 0);
});

test('submission refuses an unknown term instead of inventing a semester', async () => {
  const f = setup({ terms: [], offerings: [] });
  const result = await f.service.submitReview({
    id: 'r', teacherId: 't', courseId: 'c', termId: 'missing', yearTerm: '随便写的学期',
    dimensions: {
      attendanceStrictness: 4, gradingLeniency: 4, effortMatters: 4,
      workloadDifficulty: 4, approachability: 4, teachingQuality: 4,
    },
  });
  assert.equal(result.success, false);
  assert.match(result.message, /学期/);
  assert.equal(f.writes.length, 0);
});

test('approval, rejection and likes use the server RPC without direct writes', async () => {
  const f = setup({ reviews: [{ id: 'r1', teacher_id: 't1', status: 'pending', user_id: 'student' }] });
  assert.equal((await f.service.approveReview('r1')).success, true);
  assert.equal((await f.service.rejectReview('r1', '补充体验')).success, true);
  assert.deepEqual(f.calls.map((call) => call.name), ['approve_review', 'reject_review']);
  assert.equal(f.writes.length, 0);

  const liked = await f.service.setReviewLike('r1', true);
  assert.equal(liked.likes, 8);
  assert.equal(f.calls.at(-1).name, 'set_review_like');
  assert.equal(f.calls.at(-1).args.p_liked, true);
});

test('unrated teachers keep null scores and no fabricated title/campus', async () => {
  const f = setup({ teachers: [{
    id: 't1', name: '教师', title: null, college: '理学院', campus: null,
    review_count: 0, overall_score: 4.5, attendance_strictness: 3, grading_leniency: 4,
    teaching_quality: 4.5, rating_version: 2,
  }] });
  const teacher = await f.service.getTeacherById('t1');
  assert.equal(teacher.overallScore, null);
  assert.equal(teacher.title, null);
  assert.equal(teacher.campus, null);
  assert.equal(teacher.college, '未标注学院');
  assert.equal(teacher.dimensions.attendanceStrictness, null);
});

test('empty catalogs return empty arrays instead of demo courses or terms', async () => {
  const f = setup({ courses: [], terms: [] });
  assert.equal((await f.service.getCourses()).length, 0);
  assert.equal((await f.service.getTerms()).length, 0);
  assert.equal(f.queries.every((query) => query.table !== 'mock'), true);
});

test('personal reviews and points stay scoped to the authenticated user', async () => {
  const f = setup({
    reviews: [
      { id: 'mine', teacher_id: 't1', course_id: 'c1', term_id: 'term', year_term: '2026', user_id: 'student', status: 'pending', created_at: '2026-10-01', rating_version: 2 },
      { id: 'other', teacher_id: 't1', course_id: 'c1', term_id: 'term', year_term: '2026', user_id: 'other', status: 'approved', created_at: '2026-10-02', rating_version: 2 },
    ],
    profiles: [{ id: 'student', points: 0, last_checkin_date: null }],
  });
  const reviews = await f.service.getReviews(undefined, { userId: 'student' });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].id, 'mine');
  assert.equal(reviews[0].termId, 'term');
  const points = await f.service.getUserPoints('student');
  assert.equal(points.points, 0);
  await assert.rejects(f.service.getUserPoints('other'), /重新登录/);
});

test('approved teacher reviews can use the cache API without a direct query', async () => {
  const f = setup({
    cacheEnabled: true,
    apiResult: { items: [{ id: 'r1', teacher_id: 't1', status: 'approved', course_name: '课程', created_at: '2026-01-01' }], total: 1 },
  });
  const page = await f.service.getReviewsPage({ teacherId: 't1', status: 'approved' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].courseName, '课程');
  assert.equal(f.apiCalls.length, 1);
  assert.equal(f.queries.length, 0);
});
