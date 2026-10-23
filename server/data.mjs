export const TEACHER_SELECT = '*,colleges(id,name),course_offerings(course_id,courses(id,name),term_id,terms(id,year_term,is_current))';
// Public review reads must use the safe view. The base reviews table is reserved
// for authors/reviewers and is not readable with the anon key.
export const REVIEW_SELECT = 'id,teacher_id,course_id,term_id,year_term,attendance_strictness,grading_leniency,effort_matters,workload_difficulty,approachability,teaching_quality,comment,author_nickname,is_historical_migrated,status,created_at,likes,rating_version,course_name,teacher_name';

export const NEW_RATING_KEYS = ['attendance_strictness', 'grading_leniency', 'effort_matters',
  'workload_difficulty', 'approachability', 'teaching_quality'];
export function validateNewRatingPayload(payload) {
  for (const key of NEW_RATING_KEYS) {
    const value = payload[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'All six scores are required';
    if (value < 4 || value > 5) return 'Scores must be between 4.0 and 5.0';
    if (Number(value.toFixed(1)) !== value) return 'Scores allow at most one decimal place';
  }
  return null;
}

const teacherFields = ['id', 'name', 'title', 'college', 'college_id', 'campus', 'courses',
  'is_teaching_this_term', 'overall_score', 'review_count', 'attendance_strictness',
  'grading_leniency', 'effort_matters', 'workload_difficulty', 'approachability',
  'teaching_quality', 'has_historical_data', 'tags', 'recent_term_courses', 'rating_version'];
const reviewFields = ['id', 'teacher_id', 'course_id', 'term_id', 'year_term', 'attendance_strictness',
  'grading_leniency', 'effort_matters', 'workload_difficulty', 'approachability',
  'teaching_quality', 'comment', 'author_nickname', 'is_historical_migrated', 'status',
  'created_at', 'likes', 'rating_version', 'course_name', 'teacher_name'];
const pick = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));

export function publicTeacher(row) {
  return { ...pick(row, teacherFields),
    identity_kind: String(row.source_id || '').startsWith('tt-') ? 'timetable_unit_name' : 'official_profile',
    colleges: row.colleges ? pick(row.colleges, ['id', 'name']) : null,
    course_offerings: (row.course_offerings || []).map(off => ({
      ...pick(off, ['course_id', 'term_id']),
      courses: off.courses ? pick(off.courses, ['id', 'name']) : null,
      terms: off.terms ? pick(off.terms, ['id', 'year_term', 'is_current']) : null,
    })),
  };
}

export function publicReview(row) {
  if (!row || row.status !== 'approved') return null;
  const courseName = row.course_name || row.courses?.name;
  const teacherName = row.teacher_name || row.teachers?.name;
  return { ...pick(row, reviewFields),
    courses: row.courses ? pick(row.courses, ['id', 'name'])
      : (courseName ? { id: row.course_id, name: courseName } : null),
    teachers: row.teachers ? pick(row.teachers, ['name'])
      : (teacherName ? { name: teacherName } : null),
  };
}

// Count and stable ID ordering detect truncated pages before a snapshot is published.
export async function readAll(loadPage) {
  const rows = [];
  let total;
  let pageSize = 500;
  do {
    const result = await loadPage(rows.length, rows.length + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    if (!Array.isArray(result.data)) throw new Error('Incomplete database response');
    if (total === undefined) {
      if (!Number.isSafeInteger(result.count)) throw new Error('Missing database count');
      total = result.count;
      pageSize = result.data.length || pageSize;
    }
    if (result.data.length !== Math.min(pageSize, total - rows.length)) {
      throw new Error('Database changed during snapshot; retry required');
    }
    rows.push(...result.data);
  } while (rows.length < total);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate snapshot rows');
  return rows;
}

export function createSource(client) {
  return {
    async teachers() {
      return (await readAll((from, to) => client.from('teachers').select(TEACHER_SELECT,
        { count: from === 0 ? 'exact' : undefined }).order('id').range(from, to))).map(publicTeacher);
    },
    async teacher(id) {
      const { data, error } = await client.from('teachers').select(TEACHER_SELECT).eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? publicTeacher(data) : null;
    },
    async reviews(teacherId) {
      return (await readAll((from, to) => client.from('review_feed').select(REVIEW_SELECT,
        { count: from === 0 ? 'exact' : undefined }).eq('teacher_id', teacherId)
        .order('id').range(from, to))).map(publicReview);
    },
    async review(id) {
      const { data, error } = await client.from('review_feed').select(REVIEW_SELECT)
        .eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return publicReview(data);
    },
  };
}

function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) throw new Error('Invalid pagination');
  return number;
}
export function pagination(query) {
  const page = integer(query.page, 0, 100000);
  const pageSize = integer(query.pageSize, 20, 100);
  if (!pageSize) throw new Error('Invalid page size');
  return { page, pageSize };
}
export function teacherOptions(query) {
  const options = { ...pagination(query), query: String(query.query || '').trim(),
    collegeId: String(query.collegeId || '') };
  if (options.query.length > 200 || options.collegeId.length > 200) throw new Error('Invalid teacher filter');
  for (const flag of ['onlyThisTerm', 'courseOnly']) {
    if (query[flag] !== undefined && !['true', 'false'].includes(query[flag])) throw new Error('Invalid boolean filter');
    options[flag] = query[flag] === 'true';
  }
  return options;
}
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function teacherPage(rows, options) {
  const text = options.query.toLocaleLowerCase();
  const filtered = rows.filter(row => {
    if (options.collegeId && options.collegeId !== 'all' && row.college_id !== options.collegeId) return false;
    if (options.onlyThisTerm && !row.course_offerings?.some(off => off.terms?.is_current)) return false;
    if (!text) return true;
    const courseMatch = row.course_offerings?.some(off => off.courses?.name?.toLocaleLowerCase().includes(text));
    return options.courseOnly ? courseMatch : courseMatch || row.name?.toLocaleLowerCase().includes(text) ||
      (Array.isArray(row.tags) && row.tags.includes(options.query));
  });
  // Name + unique ID is the only public teacher order. Scores are display data,
  // never a hidden fallback sort.
  filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    || compareId(a.id, b.id));
  const start = options.page * options.pageSize;
  return { items: filtered.slice(start, start + options.pageSize), total: filtered.length };
}
export function reviewPage(rows, { page, pageSize }) {
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || compareId(a.id, b.id));
  return { items: sorted.slice(page * pageSize, (page + 1) * pageSize), total: sorted.length };
}
