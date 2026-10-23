-- Clean UPC database schema (rating v2). No old-school defaults, mock rows or
-- historical rating conversion. The generated init file adds security.sql,
-- fresh-hooks.sql and import-upc.sql in that order.
--
-- All rating values are nullable on purpose: an unrated teacher must display
-- "暂无数据", never a fabricated 4.5 default.

CREATE TABLE public.colleges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 80),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  campus TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  college_id UUID REFERENCES public.colleges(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT courses_code_length_check
    CHECK (code IS NULL OR char_length(code) BETWEEN 1 AND 80)
);
-- A formal course code is the identity when present, so the same name may have
-- multiple codes (for example different course versions). Only uncoded rows are
-- constrained by (name, college) to prevent an ambiguous duplicate.
CREATE UNIQUE INDEX courses_uncoded_name_college_idx
  ON public.courses (name, college_id) WHERE code IS NULL;
CREATE INDEX courses_name_college_idx ON public.courses (name, college_id);

CREATE TABLE public.terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 2 AND 40),
  year_term TEXT NOT NULL UNIQUE CHECK (char_length(year_term) BETWEEN 2 AND 80),
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A single current term is a database invariant, not a frontend convention.
CREATE UNIQUE INDEX terms_single_current_idx ON public.terms (is_current) WHERE is_current;

CREATE TABLE public.teachers (
  id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 160),
  source_id TEXT UNIQUE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 40),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  campus TEXT CHECK (campus IS NULL OR campus IN ('唐岛湾校区', '古镇口校区', '东营科教园区')),
  overall_score NUMERIC(3,1) CHECK (overall_score IS NULL OR overall_score BETWEEN 1 AND 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  attendance_strictness NUMERIC(3,1) CHECK (attendance_strictness IS NULL OR attendance_strictness BETWEEN 1 AND 5),
  grading_leniency NUMERIC(3,1) CHECK (grading_leniency IS NULL OR grading_leniency BETWEEN 1 AND 5),
  effort_matters NUMERIC(3,1) CHECK (effort_matters IS NULL OR effort_matters BETWEEN 1 AND 5),
  workload_difficulty NUMERIC(3,1) CHECK (workload_difficulty IS NULL OR workload_difficulty BETWEEN 1 AND 5),
  approachability NUMERIC(3,1) CHECK (approachability IS NULL OR approachability BETWEEN 1 AND 5),
  teaching_quality NUMERIC(3,1) CHECK (teaching_quality IS NULL OR teaching_quality BETWEEN 1 AND 5),
  has_historical_data BOOLEAN NOT NULL DEFAULT false,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  rating_version INTEGER NOT NULL DEFAULT 2 CHECK (rating_version = 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX teachers_college_idx ON public.teachers (college_id);
CREATE INDEX teachers_overall_idx ON public.teachers (overall_score DESC NULLS LAST, review_count DESC, id);

CREATE TABLE public.course_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES public.terms(id) ON DELETE RESTRICT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, course_id, term_id)
);
CREATE INDEX course_offerings_term_idx ON public.course_offerings (term_id);
CREATE INDEX course_offerings_course_idx ON public.course_offerings (course_id);

CREATE TABLE public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'moderator')),
  nickname TEXT NOT NULL DEFAULT '反馈审核员',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_normalized_idx ON public.admin_users (lower(email));

CREATE TABLE public.user_profiles (
  id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  last_checkin_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.point_rules (
  action_code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  points_delta INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT
);
INSERT INTO public.point_rules (action_code, label, points_delta, is_active, description) VALUES
  ('new_user_welcome', '新用户注册欢迎礼', 100, true, '注册并建立积分档案时发放一次'),
  ('review_approved', '撰写课堂反馈审核通过', 20, true, '同一评价只发放一次'),
  ('daily_checkin', '每日签到奖励', 5, true, '按 Asia/Shanghai 自然日，每日一次');

CREATE TABLE public.point_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  action_code TEXT REFERENCES public.point_rules(action_code),
  action TEXT,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  related_review_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX point_transactions_user_timestamp_idx ON public.point_transactions (user_id, timestamp DESC);

CREATE TABLE public.reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  term_id UUID NOT NULL REFERENCES public.terms(id) ON DELETE RESTRICT,
  year_term TEXT NOT NULL,
  -- No typmod: the trigger must see 4.15 and reject it instead of NUMERIC(3,1)
  -- silently rounding it to 4.2. Historical 1–5 values remain readable.
  attendance_strictness NUMERIC CHECK (attendance_strictness IS NULL OR attendance_strictness BETWEEN 1 AND 5),
  grading_leniency NUMERIC CHECK (grading_leniency IS NULL OR grading_leniency BETWEEN 1 AND 5),
  effort_matters NUMERIC CHECK (effort_matters IS NULL OR effort_matters BETWEEN 1 AND 5),
  workload_difficulty NUMERIC CHECK (workload_difficulty IS NULL OR workload_difficulty BETWEEN 1 AND 5),
  approachability NUMERIC CHECK (approachability IS NULL OR approachability BETWEEN 1 AND 5),
  teaching_quality NUMERIC CHECK (teaching_quality IS NULL OR teaching_quality BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 4000),
  author_nickname TEXT NOT NULL DEFAULT '匿名石大学子' CHECK (char_length(author_nickname) BETWEEN 1 AND 50),
  user_id TEXT,
  is_historical_migrated BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  reviewer_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
  legacy_likes INTEGER NOT NULL DEFAULT 0 CHECK (legacy_likes >= 0),
  rating_version INTEGER NOT NULL DEFAULT 2 CHECK (rating_version = 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_teacher_status_created_idx ON public.reviews (teacher_id, status, created_at DESC, id);
CREATE INDEX reviews_user_id_idx ON public.reviews (user_id);
CREATE INDEX reviews_status_created_idx ON public.reviews (status, created_at DESC, id);

CREATE TABLE public.review_likes (
  review_id TEXT NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);
CREATE INDEX review_likes_user_idx ON public.review_likes (user_id);

ALTER TABLE public.point_transactions
  ADD CONSTRAINT point_transactions_related_review_id_fkey
  FOREIGN KEY (related_review_id) REFERENCES public.reviews(id) ON DELETE SET NULL;

CREATE TABLE public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset TEXT NOT NULL,
  source TEXT NOT NULL,
  checksum TEXT NOT NULL,
  summary JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by TEXT NOT NULL DEFAULT session_user
);
