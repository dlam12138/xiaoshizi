export interface TeacherDimensions {
  // Historical records use 1–5; new submissions validate 4.0–5.0 separately.
  attendanceStrictness: number; // 越高越宽松，几乎不点名
  gradingLeniency: number;      // 越高给分越大方
  effortMatters: number;        // 越高越认可认真投入的回报
  workloadDifficulty: number;   // 越高作业负担越轻
  approachability: number;      // 越高越亲和好沟通
  teachingQuality: number;      // 越高讲解越清晰扎实
}

export type TeacherRatingDimensions = { [K in keyof TeacherDimensions]: number | null };

export interface Course {
  id: string;
  code?: string | null;
  name: string;
  collegeId?: string;
  createdAt?: string;
}

export interface Term {
  id: string;
  code: string;
  yearTerm: string;
  isCurrent: boolean;
  createdAt?: string;
}

export interface PointRule {
  actionCode: string;
  label: string;
  pointsDelta: number;
  isActive: boolean;
  description?: string;
}

export interface TeacherCourseOffering {
  id?: string;
  courseId: string;
  courseName: string;
  termId?: string;
  yearTerm?: string;
  isCurrentTerm?: boolean;
}

export interface Review {
  ratingVersion?: number;
  remote?: boolean;
  id: string;
  teacherId: string;
  teacherName?: string;
  courseId?: string; // Foreign key -> courses.id (NOT NULL in DB)
  courseName?: string; // Joined from courses.name
  termId?: string; // Foreign key -> terms.id
  yearTerm: string;
  dimensions: Partial<TeacherDimensions>;
  comment?: string;
  authorNickname: string;
  userId?: string;
  userEmail?: string;
  isHistoricalMigrated?: boolean; // 2024年前老站迁移数据
  status: 'approved' | 'pending' | 'rejected';
  rejectReason?: string; // DB column: reject_reason
  rejectionReason?: string; // Frontend compatibility alias
  reviewerId?: string;
  reviewedAt?: string;
  createdAt: string;
  likes: number;
}

export interface College {
  id: string;
  name: string;
  code?: string;
}

export interface TeacherQuery {
  query?: string;
  collegeId?: string;
  onlyThisTerm?: boolean;
  courseOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ReviewQuery {
  teacherId?: string;
  userId?: string;
  status?: Review['status'] | 'all';
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface DataPage<T> { items: T[]; total: number }

export interface Teacher {
  ratingVersion?: number;
  id: string;
  name: string;
  title: string | null; // 职称；未核实时为 null，不填默认值
  college: string; // 学院/课表来源单位名称（由 college_id 关联 colleges.name 获得）
  collegeId?: string; // 外键关联 colleges 表 (NOT NULL in DB)
  identityKind?: 'official_profile' | 'timetable_unit_name'; // 官方 profile 或课表来源学院身份
  campus: string | null; // 唐岛湾校区 / 古镇口校区 / 东营科教园区；未知为 null
  courses: string[]; // 由 course_offerings 关联获得
  courseOfferings?: TeacherCourseOffering[];
  isTeachingThisTerm: boolean; // 由 course_offerings 关联 terms (is_current = true) 获得
  overallScore: number | null;
  reviewCount: number;
  dimensions: TeacherRatingDimensions;
  hasHistoricalData: boolean; // 是否包含2024年前迁移数据
  tags: string[];
  recentTermCourses?: string[];
}

export interface RecommendationWeights {
  attendanceStrictness: number; // 倾向不点名(权重)
  gradingLeniency: number;      // 倾向给分大方(权重)
  effortMatters: number;        // 倾向付出会回报(权重)
  workloadDifficulty: number;   // 倾向作业少(权重)
  approachability: number;      // 倾向老师亲切(权重)
  teachingQuality: number;      // 倾向课程质量高(权重)
}

export interface UserPointTransaction {
  id: string;
  actionCode?: string; // Foreign key -> point_rules.action_code
  action: string;      // Human-readable label mapped from point_rules
  amount: number;      // 正数获得，负数消耗
  timestamp: string;
  balanceAfter: number;
  relatedReviewId?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  nickname?: string;
  college?: string;
  campus?: string;
  points: number;
}
