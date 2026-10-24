import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  Teacher, Review, UserPointTransaction, Course, Term, PointRule, TeacherCourseOffering,
  TeacherQuery, ReviewQuery, DataPage, GovernanceRequest, GovernanceRequestType, AdminAuditEntry,
  OfferingRatingStat,
} from '../types';
import { normalizeRatingRecord, readRating, RATING_VERSION, validateNewRatingDimensions } from '../lib/ratings';
import { validateStudentEmail } from '../lib/studentEmail';
import { cacheApiEnabled, cacheQuery, cacheRequest } from '../lib/cacheApi';

/**
 * Supabase data service for the UPC deployment.
 *
 * There is deliberately no local-review, mock-teacher or old-project fallback:
 * a missing database must fail closed and surface a configuration error.
 */

const DEFAULT_ACTION_LABELS: Record<string, string> = {
  new_user_welcome: '新用户注册欢迎礼',
  daily_checkin: '每日签到奖励',
  review_approved: '撰写课堂反馈审核通过',
};

const TEACHER_SELECT =
  '*,colleges(id,name),course_offerings(course_id,courses(id,name),term_id,terms(id,year_term,is_current))';
const AUTHOR_REVIEW_SELECT = '*,courses(id,name),teachers(name)';
const ADMIN_REVIEW_SELECT = '*';
const PUBLIC_REVIEW_SELECT =
  'id,teacher_id,course_id,term_id,year_term,attendance_strictness,grading_leniency,effort_matters,'
  + 'workload_difficulty,approachability,teaching_quality,author_nickname,status,created_week,likes,'
  + 'rating_version,course_name,teacher_name';
const CAMPUS_VALUES = new Set(['唐岛湾校区', '古镇口校区', '东营科教园区']);
const GOVERNANCE_TYPES: GovernanceRequestType[] = [
  'teacher_profile_correction', 'course_offering_correction', 'review_report',
  'review_withdrawal', 'account_deletion',
];

const searchPattern = (text: string) => `%${text.replace(/[\\%_*]/g, '\\$&')}%`;
const filterValue = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const pageBounds = (page = 0, size = 20) => {
  const pageSize = Math.min(100, Math.max(1, Math.floor(size) || 20));
  const from = Math.max(0, Math.floor(page) || 0) * pageSize;
  return { from, to: from + pageSize - 1 };
};

function decodeRatingVersion(value: unknown): number {
  return Number(value) === 1 ? 1 : 2;
}

function readJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

type RowPage = { data: any[] | null; error: { message: string } | null; count?: number | null };

async function readAllRows(loadPage: (from: number, to: number) => PromiseLike<RowPage>): Promise<any[]> {
  const readPage = async (from: number, to: number) => {
    const result = await loadPage(from, to);
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('数据库未返回查询结果');
    return { rows: result.data, count: result.count };
  };
  const first = await readPage(0, 999);
  const rows = [...first.rows];
  if (typeof first.count === 'number') {
    if (!rows.length && first.count > 0) throw new Error('数据库分页结果不完整');
    const pageSize = first.rows.length || 1000;
    for (let from = rows.length; from < first.count; from += pageSize * 4) {
      const offsets = Array.from(
        { length: Math.min(4, Math.ceil((first.count - from) / pageSize)) },
        (_, i) => from + i * pageSize,
      );
      const pages = await Promise.all(
        offsets.map((offset) => readPage(offset, Math.min(offset + pageSize, first.count!) - 1)),
      );
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].rows.length !== Math.min(pageSize, first.count - offsets[i])) {
          throw new Error('数据在读取期间发生变化，请刷新重试');
        }
        rows.push(...pages[i].rows);
      }
    }
  } else {
    while (rows.length) {
      const page = await readPage(rows.length, rows.length + 999);
      if (!page.rows.length) break;
      rows.push(...page.rows);
    }
  }
  return rows;
}

function mapTeacherRow(row: any): Teacher {
  const collegeName = row.colleges?.name || '未标注学院';
  const rawOfferings: any[] = Array.isArray(row.course_offerings) ? row.course_offerings : [];
  const offerings: TeacherCourseOffering[] = [];
  const courseNames = new Set<string>();
  const seenOfferings = new Set<string>();
  let isTeachingCurrentTerm = false;

  for (const off of rawOfferings) {
    const courseName = off.courses?.name;
    const courseId = off.course_id || off.courses?.id;
    if (!courseName || !courseId) continue;
    const key = `${courseId}:${off.term_id || ''}`;
    if (seenOfferings.has(key)) continue;
    seenOfferings.add(key);
    courseNames.add(courseName);
    const isCurrent = Boolean(off.terms?.is_current);
    if (isCurrent) isTeachingCurrentTerm = true;
    offerings.push({
      courseId,
      courseName,
      termId: off.term_id,
      yearTerm: off.terms?.year_term,
      isCurrentTerm: isCurrent,
    });
  }

  const hasRatingData = Number(row.review_count) > 0 || row.has_historical_data === true;
  const rating = (value: unknown) => (hasRatingData ? readRating(value) : null);
  const campus = typeof row.campus === 'string' && CAMPUS_VALUES.has(row.campus) ? row.campus : null;

  return normalizeRatingRecord({
    ratingVersion: decodeRatingVersion(row.rating_version),
    id: row.id,
    name: row.name,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
    college: collegeName,
    collegeId: row.college_id || row.colleges?.id || undefined,
    identityKind: (row.identity_kind === 'timetable_unit_name'
      || String(row.source_id || '').startsWith('tt-')) ? 'timetable_unit_name' : 'official_profile',
    campus,
    courses: Array.from(courseNames),
    courseOfferings: offerings,
    isTeachingThisTerm: isTeachingCurrentTerm,
    overallScore: row.rating_public === false ? null : rating(row.overall_score),
    reviewCount: Number(row.review_count) || 0,
    independentReviewerCount: Number(row.independent_reviewer_count) || 0,
    ratingVisible: row.rating_public !== false && rating(row.overall_score) !== null,
    dimensions: {
      attendanceStrictness: rating(row.attendance_strictness),
      gradingLeniency: rating(row.grading_leniency),
      effortMatters: rating(row.effort_matters),
      workloadDifficulty: rating(row.workload_difficulty),
      approachability: rating(row.approachability),
      teachingQuality: rating(row.teaching_quality),
    },
    hasHistoricalData: Boolean(row.has_historical_data),
    tags: readJsonArray(row.tags),
    recentTermCourses: readJsonArray(row.recent_term_courses),
  });
}

function mapReviewRow(row: any, publicProjection = false): Review {
  return normalizeRatingRecord({
    ratingVersion: decodeRatingVersion(row.rating_version),
    remote: true,
    id: row.id,
    teacherId: row.teacher_id,
    termId: row.term_id || undefined,
    courseId: row.course_id || row.courses?.id || undefined,
    courseName: row.courses?.name || row.course_name || '',
    yearTerm: row.year_term || '',
    dimensions: {
      attendanceStrictness: row.attendance_strictness,
      gradingLeniency: row.grading_leniency,
      effortMatters: row.effort_matters,
      workloadDifficulty: row.workload_difficulty,
      approachability: row.approachability,
      teachingQuality: row.teaching_quality,
    },
    // The public projection never contains comment or a real nickname.
    comment: publicProjection ? '' : (row.comment || ''),
    authorNickname: publicProjection ? '匿名石大学子' : (row.author_nickname || '匿名石大学子'),
    userId: publicProjection ? undefined : row.user_id,
    isHistoricalMigrated: Boolean(row.is_historical_migrated),
    status: row.status || 'pending',
    rejectReason: publicProjection ? undefined : (row.reject_reason || undefined),
    rejectionReason: publicProjection ? undefined : (row.reject_reason || undefined),
    reviewerId: publicProjection ? undefined : (row.reviewer_id || undefined),
    reviewedAt: publicProjection ? undefined : (row.reviewed_at || undefined),
    createdAt: publicProjection ? (row.created_week || '') : (row.created_at || new Date().toISOString()),
    publicTime: publicProjection,
    riskFlags: publicProjection ? undefined : (row.risk_flags || []),
    riskReason: publicProjection ? undefined : (row.risk_reason || undefined),
    isPublic: row.is_public !== false,
    likes: Number(row.likes) || 0,
    teacherName: row.teachers?.name || row.teacher_name,
  });
}

function mapGovernanceRow(row: any): GovernanceRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    requesterKind: row.requester_kind,
    source: row.source,
    targetTeacherId: row.target_teacher_id,
    targetTeacherName: row.target_teacher_name,
    targetTeacherTitle: row.target_teacher_title,
    targetTeacherCollegeCode: row.target_teacher_college_code,
    targetTeacherCampus: row.target_teacher_campus,
    targetReviewId: row.target_review_id,
    targetCourseId: row.target_course_id,
    targetCourseName: row.target_course_name,
    targetCourseCode: row.target_course_code,
    targetCourseCollegeCode: row.target_course_college_code,
    targetOfferingId: row.target_offering_id,
    targetOfferingTeacherId: row.target_offering_teacher_id,
    targetOfferingCourseId: row.target_offering_course_id,
    targetOfferingTermId: row.target_offering_term_id,
    targetOfferingSourceId: row.target_offering_source_id,
    statement: row.statement,
    evidenceSummary: row.evidence_summary,
    status: row.status,
    resolution: row.resolution,
    assignedAdminId: row.assigned_admin_id,
    externalCaseRef: row.external_case_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function requireDatabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('UPC 数据库尚未配置，请设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
  }
  return supabase;
}

export const supabaseService = {
  async getTeachersPage(options: TeacherQuery = {}, signal?: AbortSignal): Promise<DataPage<Teacher>> {
    if (cacheApiEnabled) {
      const data = await cacheRequest<DataPage<any>>(`/teachers?${cacheQuery({ ...options })}`, { signal });
      return { items: data.items.map(mapTeacherRow), total: data.total };
    }
    const db = requireDatabase();
    const text = options.query?.trim() || '';
    const { from, to } = pageBounds(options.page, options.pageSize);
    let select = TEACHER_SELECT;
    if (text) select += ',course_matches:course_offerings(courses!inner())';
    if (options.onlyThisTerm) select += ',current_offerings:course_offerings!inner(terms!inner())';
    let query = db.from('teachers').select(select, { count: 'exact' });
    if (text) {
      const pattern = searchPattern(text);
      query = query.ilike('course_matches.courses.name', pattern);
      query = options.courseOnly
        ? query.not('course_matches', 'is', null)
        : query.or(`name.ilike.${filterValue(pattern)},tags.cs.${filterValue(JSON.stringify([text]))},course_matches.not.is.null`);
    }
    if (options.collegeId && options.collegeId !== 'all') query = query.eq('college_id', options.collegeId);
    if (options.onlyThisTerm) query = query.eq('current_offerings.terms.is_current', true);
    // Stable, score-independent order. The unique ID is the pagination tie-breaker.
    query = query
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { items: (data || []).map(mapTeacherRow), total: count ?? 0 };
  },

  async getTeacherById(id: string): Promise<Teacher | null> {
    if (cacheApiEnabled) {
      const row = await cacheRequest<any>(`/teachers/${encodeURIComponent(id)}`);
      return row ? mapTeacherRow(row) : null;
    }
    const db = requireDatabase();
    const { data, error } = await db.from('teachers').select(TEACHER_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapTeacherRow(data) : null;
  },

  async getOfferingRatingStats(teacherId: string): Promise<OfferingRatingStat[]> {
    const db = requireDatabase();
    const { data, error } = await db.from('offering_rating_stats')
      .select('teacher_id,course_id,term_id,review_count,independent_reviewer_count,rating_public,overall_score,courses(name),terms(year_term)')
      .eq('teacher_id', teacherId)
      .order('term_id', { ascending: false })
      .order('course_id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      teacherId: row.teacher_id,
      courseId: row.course_id,
      termId: row.term_id,
      courseName: row.courses?.name || '',
      yearTerm: row.terms?.year_term || '',
      reviewCount: Number(row.review_count) || 0,
      independentReviewerCount: Number(row.independent_reviewer_count) || 0,
      ratingPublic: Boolean(row.rating_public),
      overallScore: row.rating_public ? readRating(row.overall_score) : null,
    }));
  },

  async getTeachers(): Promise<Teacher[]> {
    const db = requireDatabase();
    const rows = await readAllRows((from, to) =>
      db.from('teachers').select(TEACHER_SELECT, { count: from === 0 ? 'exact' : undefined })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(mapTeacherRow);
  },

  async getReviews(teacherId?: string, scope?: { userId?: string }): Promise<Review[]> {
    const db = requireDatabase();
    const rows = await readAllRows((from, to) => {
      let query = db.from('reviews')
        .select(AUTHOR_REVIEW_SELECT, { count: from === 0 ? 'exact' : undefined })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      if (teacherId) query = query.eq('teacher_id', teacherId);
      if (scope?.userId) query = query.eq('user_id', scope.userId);
      return query.range(from, to);
    });
    return rows.map((row) => mapReviewRow(row, false));
  },

  async getReviewsPage(options: ReviewQuery, signal?: AbortSignal): Promise<DataPage<Review>> {
    if (options.status && options.status !== 'approved') {
      throw new Error('非公开评价只能通过管理员审核接口读取');
    }
    if (cacheApiEnabled && options.teacherId && !options.userId && !options.query) {
      const query = cacheQuery({ page: options.page, pageSize: options.pageSize });
      const data = await cacheRequest<DataPage<any>>(
        `/teachers/${encodeURIComponent(options.teacherId)}/reviews?${query}`,
        { signal },
      );
      return { items: data.items.map((row) => mapReviewRow(row, true)), total: data.total };
    }
    const db = requireDatabase();
    const { from, to } = pageBounds(options.page, options.pageSize);
    // review_feed exposes only approved, non-identifying columns and only when
    // the offering has reached the independent-reviewer threshold. Ordering by
    // the week bucket avoids leaking the exact submission order through a
    // hidden timestamp.
    let query = db.from('review_feed').select(PUBLIC_REVIEW_SELECT, { count: 'exact' });
    if (options.teacherId) query = query.eq('teacher_id', options.teacherId);
    query = query.order('created_week', { ascending: false }).order('id', { ascending: true }).range(from, to);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { items: (data || []).map((row) => mapReviewRow(row, true)), total: count ?? 0 };
  },

  async getAdminReviewsPage(options: ReviewQuery, signal?: AbortSignal): Promise<DataPage<Review>> {
    const db = requireDatabase();
    const { from, to } = pageBounds(options.page, options.pageSize);
    const text = options.query?.trim();
    // Reviewers use a controlled view: no applicant user_id/email, but enough
    // moderation fields to approve, reject or inspect risk flags.
    let query = db.from('admin_review_queue').select(ADMIN_REVIEW_SELECT, { count: 'exact' });
    if (options.teacherId) query = query.eq('teacher_id', options.teacherId);
    if (options.status && options.status !== 'all') query = query.eq('status', options.status);
    if (text) {
      const pattern = searchPattern(text);
      query = query.or(
        `comment.ilike.${filterValue(pattern)},teacher_name.ilike.${filterValue(pattern)},course_name.ilike.${filterValue(pattern)}`,
      );
    }
    query = query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { items: (data || []).map((row) => mapReviewRow(row, false)), total: count ?? 0 };
  },

  async getReviewCounts(): Promise<Record<'pending' | 'approved' | 'rejected' | 'withdrawn', number>> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('get_admin_review_counts');
    if (error) throw new Error(error.message);
    const source = data && typeof data === 'object' ? data : {};
    return {
      pending: Number(source.pending) || 0,
      approved: Number(source.approved) || 0,
      rejected: Number(source.rejected) || 0,
      withdrawn: Number(source.withdrawn) || 0,
    };
  },

  async getCoursesPage(text: string, signal?: AbortSignal): Promise<DataPage<Course>> {
    const db = requireDatabase();
    let query = db.from('courses').select('id,name,college_id', { count: 'exact' })
      .ilike('name', searchPattern(text.trim())).order('name').order('id').range(0, 19);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { items: (data || []).map((c: any) => ({ id: c.id, name: c.name, collegeId: c.college_id })), total: count ?? 0 };
  },

  async getCourses(collegeId?: string): Promise<Course[]> {
    const db = requireDatabase();
    const rows = await readAllRows((from, to) => {
      let query = db.from('courses').select('*', { count: from === 0 ? 'exact' : undefined })
        .order('name').order('id', { ascending: true });
      if (collegeId && collegeId !== 'all') query = query.eq('college_id', collegeId);
      return query.range(from, to);
    });
    return rows.map((c: any) => ({
      id: c.id,
      name: c.name,
      collegeId: c.college_id,
      createdAt: c.created_at,
    }));
  },

  async getColleges(): Promise<Array<{ id: string; name: string; code?: string; campus?: string | null }> | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase.from('colleges').select('*').order('code');
      if (error) throw new Error(error.message);
      return (data || []).map((college: any) => ({
        id: college.id,
        name: college.name,
        code: college.code,
        campus: college.campus,
      }));
    } catch (err) {
      console.warn('[Supabase] 学院字典读取失败:', err);
      return null;
    }
  },

  async getTerms(): Promise<Term[]> {
    const db = requireDatabase();
    const { data, error } = await db.from('terms').select('*').order('is_current', { ascending: false }).order('code');
    if (error) throw new Error(error.message);
    return (data || []).map((t: any) => ({
      id: t.id,
      code: t.code,
      yearTerm: t.year_term,
      isCurrent: Boolean(t.is_current),
      createdAt: t.created_at,
    }));
  },

  async getPointRules(): Promise<PointRule[]> {
    const db = requireDatabase();
    const { data, error } = await db.from('point_rules').select('*').order('points_delta', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      actionCode: r.action_code,
      label: r.label,
      pointsDelta: Number(r.points_delta),
      isActive: Boolean(r.is_active),
      description: r.description,
    }));
  },

  async submitReview(review: Review): Promise<{ success: boolean; message?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, message: '数据库未配置，评价未提交。请设置 UPC Supabase 环境变量后重试。' };
    }
    try {
      const sessionUser = (await supabase.auth.getUser())?.data?.user;
      if (!sessionUser) return { success: false, message: '提交未通过安全校验：请先登录后再提交反馈。' };
      if (!sessionUser.email_confirmed_at) {
        return { success: false, message: '请先完成学生邮箱验证后再提交评价。' };
      }
      if (!validateStudentEmail(sessionUser.email).ok) {
        return { success: false, message: '仅已验证的中国石油大学（华东）学生邮箱账户可提交评价。' };
      }
      if (review.comment?.trim()) {
        return { success: false, message: '文字评论未开放，请仅提交六维评分。' };
      }

      if (!review.teacherId) return { success: false, message: '提交失败：请选择教师。' };
      if (!review.courseId) return { success: false, message: '提交失败：请选择该教师的开课课程。' };
      const ratingError = validateNewRatingDimensions(review.dimensions);
      if (ratingError) return { success: false, message: `提交失败：${ratingError}` };

      const term = await this.resolveReviewTerm(review.termId, review.yearTerm);
      if (!term) return { success: false, message: '提交失败：未找到有效学期，请联系管理员初始化学期字典。' };

      const offering = await this.findOffering(review.teacherId, review.courseId, term.id);
      if (!offering) {
        return { success: false, message: '提交失败：所选课程不在该教师的开课关系中，请刷新后重新选择。' };
      }

      const insertPayload: any = {
        rating_version: RATING_VERSION,
        id: review.id,
        teacher_id: review.teacherId,
        course_id: review.courseId,
        term_id: term.id,
        year_term: term.yearTerm,
        attendance_strictness: review.dimensions.attendanceStrictness,
        grading_leniency: review.dimensions.gradingLeniency,
        effort_matters: review.dimensions.effortMatters,
        workload_difficulty: review.dimensions.workloadDifficulty,
        approachability: review.dimensions.approachability,
        teaching_quality: review.dimensions.teachingQuality,
        author_nickname: '匿名石大学子',
        user_id: sessionUser.id,
        is_historical_migrated: false,
        status: 'pending',
        likes: 0,
      };

      const { error } = await supabase.from('reviews').insert(insertPayload);
      if (error) {
        let userMsg = error.message;
        if (error.code === '23505' || userMsg.includes('reviews_business_key_uidx')) {
          userMsg = '你已评价过该教师×课程×学期；请到个人中心修改原评价，不能重复提交。';
        } else if (error.code === '42501' || userMsg.includes('row-level security')) {
          userMsg = '数据库安全策略拒绝了写入，请确认已登录且评价字段符合当前规则。';
        }
        return { success: false, message: userMsg };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || '网络连接异常，未能存入数据库' };
    }
  },

  async updateMyReview(review: Review): Promise<{ success: boolean; message?: string }> {
    if (!isSupabaseConfigured || !supabase) return { success: false, message: '数据库未配置，评价未保存。' };
    try {
      const sessionUser = (await supabase.auth.getUser())?.data?.user;
      if (!sessionUser) return { success: false, message: '请先登录' };
      if (!sessionUser.email_confirmed_at || !validateStudentEmail(sessionUser.email).ok) {
        return { success: false, message: '仅已验证学生邮箱账户可修改评价。' };
      }
      if (review.comment?.trim()) {
        return { success: false, message: '文字评论未开放，请仅提交六维评分。' };
      }

      if (!review.courseId) return { success: false, message: '请选择该教师的开课课程' };
      const ratingError = validateNewRatingDimensions(review.dimensions);
      if (ratingError) return { success: false, message: ratingError };
      const term = await this.resolveReviewTerm(review.termId, review.yearTerm);
      if (!term) return { success: false, message: '未找到有效学期，请刷新后重试' };
      if (!(await this.findOffering(review.teacherId, review.courseId, term.id))) {
        return { success: false, message: '所选课程不在该教师的开课关系中' };
      }

      const updatePayload: any = {
        rating_version: RATING_VERSION,
        course_id: review.courseId,
        term_id: term.id,
        year_term: term.yearTerm,
        attendance_strictness: review.dimensions.attendanceStrictness,
        grading_leniency: review.dimensions.gradingLeniency,
        effort_matters: review.dimensions.effortMatters,
        workload_difficulty: review.dimensions.workloadDifficulty,
        approachability: review.dimensions.approachability,
        teaching_quality: review.dimensions.teachingQuality,
        status: 'pending',
        reject_reason: null,
      };

      if (cacheApiEnabled) {
        await cacheRequest(`/reviews/${encodeURIComponent(review.id)}`, {
          method: 'PATCH', authenticated: true, body: updatePayload,
        });
      } else {
        const { error } = await supabase.from('reviews').update(updatePayload)
          .eq('id', review.id).eq('user_id', sessionUser.id);
        if (error) {
          const duplicate = error.code === '23505' || error.message.includes('reviews_business_key_uidx');
          return {
            success: false,
            message: duplicate
              ? '修改后的教师×课程×学期与另一条评价重复，请保留一条并先撤回另一条。'
              : error.message,
          };
        }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },

  async resolveReviewTerm(termId?: string, yearTerm?: string): Promise<Term | null> {
    if (!supabase) return null;
    let query = supabase.from('terms').select('*');
    query = termId ? query.eq('id', termId) : query.eq('year_term', yearTerm || '');
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      code: data.code,
      yearTerm: data.year_term,
      isCurrent: Boolean(data.is_current),
      createdAt: data.created_at,
    };
  },

  async findOffering(teacherId: string, courseId: string, termId: string): Promise<boolean> {
    if (!supabase) return false;
    const { data, error } = await supabase.from('course_offerings').select('id')
      .eq('teacher_id', teacherId).eq('course_id', courseId).eq('term_id', termId).maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  },

  async approveReview(reviewId: string): Promise<{ success: boolean; message?: string }> {
    if (!isSupabaseConfigured || !supabase) return { success: false, message: '数据库未连接，无法审核' };
    try {
      const { data, error } = cacheApiEnabled
        ? { data: await cacheRequest<any>(`/reviews/${encodeURIComponent(reviewId)}/approve`, { method: 'POST', authenticated: true }), error: null }
        : await supabase.rpc('approve_review', { p_review_id: reviewId });
      if (error || data?.success !== true) {
        return { success: false, message: error?.message || data?.message || '审核未完成，请刷新后重试' };
      }
      return { success: true, message: data.message || '评价已通过审核' };
    } catch (err: any) {
      return { success: false, message: err?.message || '审核结果无法确认，请刷新后重试' };
    }
  },

  async rejectReview(reviewId: string, reason: string): Promise<{ success: boolean; message?: string }> {
    if (!isSupabaseConfigured || !supabase) return { success: false, message: '数据库未连接，无法审核' };
    try {
      const { data, error } = cacheApiEnabled
        ? {
          data: await cacheRequest<any>(`/reviews/${encodeURIComponent(reviewId)}/reject`, {
            method: 'POST', authenticated: true,
            body: { reason: reason || '内容不符合审核规范，请修改后重新提交' },
          }), error: null,
        }
        : await supabase.rpc('reject_review', {
          p_review_id: reviewId,
          p_reason: reason || '内容不符合审核规范，请修改后重新提交',
        });
      if (error || data?.success !== true) {
        return { success: false, message: error?.message || data?.message || '驳回未完成，请刷新后重试' };
      }
      return { success: true, message: data.message || '评价已被驳回' };
    } catch (err: any) {
      return { success: false, message: err?.message || '驳回结果无法确认，请刷新后重试' };
    }
  },

  async updateReviewStatus(
    reviewId: string,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): Promise<boolean> {
    const result = status === 'approved'
      ? await this.approveReview(reviewId)
      : await this.rejectReview(reviewId, rejectionReason || '未说明驳回理由');
    return result.success;
  },

  async deleteReview(reviewId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return false;
    try {
      if (cacheApiEnabled) {
        await cacheRequest(`/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE', authenticated: true });
        return true;
      }
      const { error, count } = await supabase.from('reviews')
        .delete({ count: 'exact' }).eq('id', reviewId);
      return !error && count === 1;
    } catch (err) {
      console.warn('[Supabase] 删除评价失败:', err);
      return false;
    }
  },

  async deleteReviewAsAdmin(reviewId: string, reason: string): Promise<{ success: boolean; message?: string }> {
    if (!isSupabaseConfigured || !supabase) return { success: false, message: '数据库未连接' };
    try {
      if (cacheApiEnabled) {
        await cacheRequest(`/reviews/${encodeURIComponent(reviewId)}/admin-delete`, {
          method: 'POST', authenticated: true, body: { reason },
        });
        return { success: true };
      }
      const { data, error } = await supabase.rpc('delete_review_as_admin', {
        p_review_id: reviewId,
        p_reason: reason || '管理员删除违规评价',
      });
      if (error || data?.success !== true) {
        return { success: false, message: error?.message || '删除未完成' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || '删除结果无法确认' };
    }
  },

  subscribeToReviews(onChange: () => void): { unsubscribe: () => void } {
    if (!isSupabaseConfigured || !supabase) return { unsubscribe: () => {} };
    try {
      const channel = supabase
        .channel('reviews_realtime_' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => onChange())
        .subscribe();
      return {
        unsubscribe: () => {
          try { supabase?.removeChannel(channel); } catch (e) { console.warn('[Supabase Realtime]', e); }
        },
      };
    } catch (e) {
      console.warn('[Supabase Realtime] 订阅失败:', e);
      return { unsubscribe: () => {} };
    }
  },

  async getUserPoints(userId: string): Promise<{
    points: number; transactions: UserPointTransaction[]; hasCheckedInToday: boolean;
  }> {
    const db = requireDatabase();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user || auth.user.id !== userId) throw new Error('请重新登录后查看积分');
    const [userRes, txRes] = await Promise.all([
      db.from('user_profiles').select('points, last_checkin_date').eq('id', userId).maybeSingle(),
      db.from('point_transactions').select('*').eq('user_id', userId).order('timestamp', { ascending: false }),
    ]);
    if (userRes.error) throw new Error(userRes.error.message);
    if (txRes.error) throw new Error(txRes.error.message);
    if (!userRes.data || !Number.isSafeInteger(userRes.data.points) || userRes.data.points < 0) {
      throw new Error('未找到有效积分账户，请确认数据库初始化已完成');
    }
    const transactions: UserPointTransaction[] = (txRes.data || []).map((t: any) => ({
      id: t.id,
      actionCode: t.action_code,
      // Old point rows store the label text. Re-map the known code so historical
      // transactions do not keep exposing the retired brand wording.
      action: t.action_code && DEFAULT_ACTION_LABELS[t.action_code]
        ? DEFAULT_ACTION_LABELS[t.action_code]
        : (t.action || '积分变动'),
      amount: Number(t.amount),
      timestamp: t.timestamp
        ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '刚刚',
      balanceAfter: Number(t.balance_after),
      relatedReviewId: t.related_review_id || undefined,
    }));
    const checkinDate = userRes.data.last_checkin_date
      ? String(userRes.data.last_checkin_date).slice(0, 10)
      : null;
    return {
      points: userRes.data.points,
      transactions,
      hasCheckedInToday: checkinDate === this.getLocalDateString(),
    };
  },

  async handleDailyCheckin(userId: string): Promise<{
    success: boolean; points: number; alreadyCheckedIn: boolean; message?: string;
  }> {
    const failure = (message: string) => ({ success: false, points: 0, alreadyCheckedIn: false, message });
    if (!isSupabaseConfigured || !supabase) return failure('数据库未连接，签到未完成');
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user || auth.user.id !== userId) return failure('请重新登录后签到');
      const { data, error } = await supabase.rpc('handle_daily_checkin');
      if (error) return failure(error.message || '签到失败，请稍后重试');
      const res = Array.isArray(data) ? data[0] : data;
      if (!res || !Number.isSafeInteger(res.points) || res.points < 0 || typeof res.already_checked_in !== 'boolean') {
        return failure('签到结果无法确认，请刷新积分后重试');
      }
      return { success: true, points: res.points, alreadyCheckedIn: res.already_checked_in };
    } catch (err: any) {
      return failure(err?.message || '签到结果无法确认，请刷新积分后重试');
    }
  },

  async signUp(email: string, password: string, metadata?: { nickname?: string; college?: string; campus?: string }) {
    const db = requireDatabase();
    const checked = validateStudentEmail(email);
    if (!checked.ok) throw new Error(checked.message || '仅限学校邮箱注册');
    const { data, error } = await db.auth.signUp({
      email: checked.email,
      password,
      options: {
        data: {
          nickname: metadata?.nickname || '石大学子',
          ...(metadata?.college ? { college: metadata.college } : {}),
          ...(metadata?.campus ? { campus: metadata.campus } : {}),
        },
      },
    });
    if (error) throw error;
    const isAlreadyRegistered = Boolean(
      data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0,
    );
    if (isAlreadyRegistered) throw new Error('User already registered');
    return data;
  },

  async resetPassword(email: string) {
    const db = requireDatabase();
    const { data, error } = await db.auth.resetPasswordForEmail(email, {
      // Supabase appends its recovery token to this URL. The app must handle
      // PASSWORD_RECOVERY and let the user set a new password before leaving.
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    if (error) throw error;
    return data;
  },

  async updatePassword(password: string) {
    const db = requireDatabase();
    if (!password || password.length < 6) throw new Error('密码长度不能少于 6 位');
    const { data, error } = await db.auth.updateUser({ password });
    if (error) throw error;
    // Drop the recovery token fragment after a successful save. Password update
    // must not be reported as failed just because history rewriting is blocked.
    try {
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch {
      // Ignore history restrictions; the recovery session is already consumed.
    }
    return data;
  },

  /**
   * Email changes are a separate Auth path. The browser mirrors the server
   * domain rule, but the auth.users trigger is the authoritative guard.
   */
  async updateStudentEmail(email: string) {
    const db = requireDatabase();
    const checked = validateStudentEmail(email);
    if (!checked.ok) throw new Error(checked.message || '仅允许学生邮箱');
    const user = (await db.auth.getUser())?.data?.user;
    if (!user) throw new Error('请先登录');
    const { data, error } = await db.auth.updateUser({ email: checked.email });
    if (error) throw error;
    return data;
  },

  hasRecoveryParams() {
    if (typeof window === 'undefined') return false;
    return window.location.hash.includes('type=recovery')
      || new URLSearchParams(window.location.search).get('type') === 'recovery';
  },

  async resendVerificationEmail(email: string) {
    const db = requireDatabase();
    const { data, error } = await db.auth.resend({ type: 'signup', email });
    if (error) throw error;
    return data;
  },

  async signIn(email: string, password: string) {
    const db = requireDatabase();
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) console.warn('[Supabase] 退出登录失败:', error.message);
  },

  async getCurrentUser() {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      return error || !user ? null : user;
    } catch {
      return null;
    }
  },

  async ensureUserProfile(_userId: string, _email: string) {
    // Created transactionally by the auth.users trigger; never invent a local balance.
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    if (!isSupabaseConfigured || !supabase) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return supabase.auth.onAuthStateChange(callback);
  },

  async checkIsAdmin(_email?: string, _userMetadata?: any): Promise<{
    isAdmin: boolean; role?: string; nickname?: string;
    canInvestigateIdentity?: boolean; completedAal2?: boolean; mfaRequired?: boolean;
  }> {
    if (!isSupabaseConfigured || !supabase) return { isAdmin: false };
    try {
      const { data, error } = await supabase.rpc('get_my_admin_status');
      if (error || data?.is_admin !== true || !['super_admin', 'admin', 'moderator'].includes(data.role)) {
        return { isAdmin: false };
      }
      return {
        isAdmin: true,
        role: data.role,
        nickname: data.nickname || undefined,
        canInvestigateIdentity: Boolean(data.can_investigate_identity),
        completedAal2: Boolean(data.completed_aal2),
        mfaRequired: data.mfa_required !== false,
      };
    } catch {
      return { isAdmin: false };
    }
  },

  async listMfaFactors() {
    const db = requireDatabase();
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    return data;
  },

  async enrollTotp() {
    const db = requireDatabase();
    const { data, error } = await db.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: '小石子管理员',
    });
    if (error) throw error;
    return data;
  },

  async verifyTotp(factorId: string, code: string) {
    const db = requireDatabase();
    const challenge = await db.auth.mfa.challenge({ factorId });
    if (challenge.error) throw challenge.error;
    const verified = await db.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (verified.error) throw verified.error;
    return verified.data;
  },

  async getAdminList(): Promise<Array<{
    id: string; user_id: string; role: string; nickname: string; is_active: boolean;
    can_investigate_identity: boolean; created_at: string;
  }>> {
    const db = requireDatabase();
    const { data, error } = await db.from('admin_directory').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async setAdminRole(
    userId: string, role: string = 'admin', nickname: string = '反馈审核员',
    canInvestigateIdentity = false,
  ): Promise<{ success: boolean; message?: string }> {
    if (!userId || !isSupabaseConfigured || !supabase || !['super_admin', 'admin', 'moderator'].includes(role)) {
      return { success: false, message: '参数不完整' };
    }
    try {
      const { data, error } = await supabase.rpc('set_admin_role', {
        p_user_id: userId,
        p_role: role,
        p_nickname: nickname,
        p_can_investigate_identity: canInvestigateIdentity,
      });
      if (error || data?.success !== true) return { success: false, message: error?.message || '保存失败' };
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || '保存失败' };
    }
  },

  async toggleAdminStatus(userId: string, isActive: boolean): Promise<boolean> {
    if (!userId || !isSupabaseConfigured || !supabase) return false;
    try {
      const { data, error } = await supabase.rpc('set_admin_active', {
        p_user_id: userId,
        p_active: isActive,
      });
      return !error && data?.success === true;
    } catch {
      return false;
    }
  },

  async createAdminInvite(email: string, hours = 24): Promise<{ success: boolean; message?: string }> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('create_admin_invite', {
      p_email: email.trim().toLowerCase(),
      p_hours: hours,
    });
    if (error || data?.success !== true) return { success: false, message: error?.message || '邀请创建失败' };
    return { success: true };
  },

  async getAdminAuditLog(limit = 100): Promise<AdminAuditEntry[]> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('get_admin_audit_log', { p_limit: limit });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  },

  async getMyGovernanceRequests(): Promise<GovernanceRequest[]> {
    const db = requireDatabase();
    const { data, error } = await db.from('governance_requests').select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(mapGovernanceRow);
  },

  async submitGovernanceRequest(input: {
    type: GovernanceRequestType;
    statement: string;
    targetTeacherId?: string | null;
    targetReviewId?: string | null;
    targetCourseId?: string | null;
    targetOfferingId?: string | null;
    evidenceSummary?: string | null;
  }): Promise<{ success: boolean; id?: string; message?: string }> {
    if (!isSupabaseConfigured || !supabase) return { success: false, message: '数据库未连接' };
    if (!GOVERNANCE_TYPES.includes(input.type)) return { success: false, message: '不支持的申请类型' };
    if (input.statement.trim().length < 10) return { success: false, message: '申请说明至少 10 个字符' };
    try {
      const { data, error } = await supabase.rpc('submit_governance_request', {
        p_type: input.type,
        p_statement: input.statement.trim(),
        p_target_teacher_id: input.targetTeacherId || null,
        p_target_review_id: input.targetReviewId || null,
        p_target_course_id: input.targetCourseId || null,
        p_target_offering_id: input.targetOfferingId || null,
        p_evidence_summary: input.evidenceSummary?.trim() || null,
      });
      if (error || data?.success !== true) return { success: false, message: error?.message || '提交失败' };
      return { success: true, id: data.id };
    } catch (err: any) {
      return { success: false, message: err?.message || '提交失败' };
    }
  },

  async withdrawGovernanceRequest(requestId: string): Promise<{ success: boolean; message?: string }> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('withdraw_governance_request', { p_request_id: requestId });
    if (error || data?.success !== true) return { success: false, message: error?.message || '撤回失败' };
    return { success: true };
  },

  async getAdminGovernanceQueue(): Promise<GovernanceRequest[]> {
    const db = requireDatabase();
    const { data, error } = await db.from('admin_governance_queue').select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(mapGovernanceRow);
  },

  async processGovernanceRequest(
    requestId: string, status: GovernanceRequest['status'], resolution: string,
  ): Promise<{ success: boolean; message?: string }> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('process_governance_request', {
      p_request_id: requestId,
      p_status: status,
      p_resolution: resolution,
    });
    if (error || data?.success !== true) return { success: false, message: error?.message || '处理失败' };
    return { success: true };
  },

  async applyGovernanceCorrection(
    requestId: string, patch: Record<string, unknown>, sourceBasis: string,
  ): Promise<{
    success: boolean;
    message?: string;
    changedFields?: string[];
    targetType?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }> {
    const db = requireDatabase();
    const { data, error } = await db.rpc('apply_governance_correction', {
      p_request_id: requestId,
      p_patch: patch,
      p_source_basis: sourceBasis,
    });
    if (error || data?.success !== true) return { success: false, message: error?.message || '写回失败' };
    return {
      success: true,
      changedFields: Array.isArray(data.changed_fields) ? data.changed_fields : [],
      targetType: data.target_type,
      before: data.before,
      after: data.after,
    };
  },

  async getMyLikedReviewIds(): Promise<string[]> {
    const db = requireDatabase();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return [];
    const ids: string[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db.from('review_likes').select('review_id')
        .eq('user_id', auth.user.id).order('review_id').range(offset, offset + pageSize - 1);
      if (error) throw new Error('点赞状态读取失败，请刷新后重试');
      ids.push(...(data || []).map((row: any) => row.review_id));
      if (!data || data.length < pageSize) return ids;
    }
  },

  async setReviewLike(reviewId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
    const db = requireDatabase();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) throw new Error('请先登录后点赞');
    const { data, error } = cacheApiEnabled
      ? {
        data: await cacheRequest<any>(`/reviews/${encodeURIComponent(reviewId)}/like`, {
          method: 'POST', authenticated: true, body: { liked },
        }), error: null,
      }
      : await db.rpc('set_review_like', { p_review_id: reviewId, p_liked: liked });
    if (error) throw new Error(error.message);
    if (!data || !Number.isSafeInteger(data.likes) || data.likes < 0 || typeof data.liked !== 'boolean') {
      throw new Error('点赞结果无法确认，请刷新后重试');
    }
    return data;
  },

  getLocalDateString(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  },
};
