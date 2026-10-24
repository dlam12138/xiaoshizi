-- UPC launch security and governance schema additions.
-- This file is intentionally incremental: clean installs and already-initialized
-- databases both execute it. It never deletes, merges or rewrites business rows.
-- Run after base-schema.sql and before security.sql / governance.sql.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- Controlled operational settings. These are private so the public API cannot
-- discover thresholds or anti-abuse windows.
CREATE TABLE IF NOT EXISTS private.upc_security_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO private.upc_security_settings (key, value) VALUES
  ('review_rate_seconds', '60'::jsonb),
  ('review_daily_limit', '10'::jsonb),
  ('offering_burst_window_minutes', '60'::jsonb),
  ('offering_burst_unique_users', '5'::jsonb),
  ('governance_daily_limit', '5'::jsonb),
  ('min_independent_reviews', '5'::jsonb),
  ('require_admin_aal2', 'true'::jsonb),
  ('audit_retention_days', '730'::jsonb)
ON CONFLICT (key) DO NOTHING;
UPDATE private.upc_security_settings
SET value = 'true'::jsonb, updated_at = now()
WHERE key = 'require_admin_aal2' AND value = 'false'::jsonb;
REVOKE ALL ON private.upc_security_settings FROM PUBLIC, anon, authenticated;

-- Administrator identity is bound to the immutable auth subject. Email remains
-- for display/contact only and is no longer the authorization key.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS can_investigate_identity BOOLEAN NOT NULL DEFAULT false;
UPDATE public.admin_users a
SET user_id = u.id
FROM auth.users u
WHERE a.user_id IS NULL AND lower(u.email) = lower(a.email);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_user_id_uidx
  ON public.admin_users (user_id) WHERE user_id IS NOT NULL;

-- Private, expiring, exact-address invites for operator-selected Gmail
-- administrator accounts. This is not a public domain allowlist: only the Auth
-- Hook and the SECURITY DEFINER invite RPC can read it. Student signup never
-- consults it.
CREATE TABLE IF NOT EXISTS private.upc_admin_invites (
  email TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);
REVOKE ALL ON private.upc_admin_invites FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS upc_admin_invites_expiry_idx
  ON private.upc_admin_invites (expires_at) WHERE used_at IS NULL;

-- Review business validity, anti-abuse evidence and withdrawal state.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS risk_flags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS risk_reason TEXT;
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));

-- Fail closed before creating the business uniqueness constraint. Group-level
-- counts are enough for the operator report; no raw identity is printed.
-- BEGIN governance-boundary-key
DO $$
DECLARE duplicate_groups INTEGER;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT user_id, teacher_id, course_id, term_id
    FROM public.reviews
    WHERE user_id IS NOT NULL AND status <> 'withdrawn'
    GROUP BY user_id, teacher_id, course_id, term_id
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'SEC-P0-02 preflight: % duplicate active (non-withdrawn) review business groups remain; preserve all rows and have an operator resolve ownership/archival mapping before retrying. Withdrawn rows do not occupy the business key', duplicate_groups
      USING ERRCODE = '23505';
  END IF;
END $$;
DROP INDEX IF EXISTS public.reviews_business_key_uidx;
CREATE UNIQUE INDEX reviews_business_key_uidx
  ON public.reviews (user_id, teacher_id, course_id, term_id)
  WHERE user_id IS NOT NULL AND status <> 'withdrawn';
-- END governance-boundary-key

-- Atomic rate-limit state. The row is created/locked in the review trigger so
-- two real connections cannot both pass the same window.
CREATE TABLE IF NOT EXISTS private.upc_review_rate_limits (
  user_id TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_count INTEGER NOT NULL CHECK (window_count >= 0),
  day_bucket DATE NOT NULL,
  day_count INTEGER NOT NULL CHECK (day_count >= 0),
  last_review_id TEXT,
  last_submitted_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON private.upc_review_rate_limits FROM PUBLIC, anon, authenticated;

-- Durable reward marker keyed by the review business combination, not only by
-- the mutable review ID. review_id remains for legacy traceability.
CREATE TABLE IF NOT EXISTS private.upc_review_rewards (
  review_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  teacher_id TEXT,
  course_id UUID,
  term_id UUID,
  business_key TEXT,
  status TEXT NOT NULL DEFAULT 'awarded'
    CHECK (status IN ('awarded', 'needs_verification')),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE private.upc_review_rewards
  ADD COLUMN IF NOT EXISTS teacher_id TEXT;
ALTER TABLE private.upc_review_rewards
  ADD COLUMN IF NOT EXISTS course_id UUID;
ALTER TABLE private.upc_review_rewards
  ADD COLUMN IF NOT EXISTS term_id UUID;
ALTER TABLE private.upc_review_rewards
  ADD COLUMN IF NOT EXISTS business_key TEXT;
ALTER TABLE private.upc_review_rewards
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'awarded';
ALTER TABLE private.upc_review_rewards DROP CONSTRAINT IF EXISTS upc_review_rewards_status_check;
ALTER TABLE private.upc_review_rewards
  ADD CONSTRAINT upc_review_rewards_status_check
  CHECK (status IN ('awarded', 'needs_verification'));

UPDATE private.upc_review_rewards rw
SET teacher_id = r.teacher_id,
    course_id = r.course_id,
    term_id = r.term_id,
    business_key = rw.user_id || '|' || r.teacher_id || '|' || r.course_id::text || '|' || r.term_id::text
FROM public.reviews r
WHERE r.id = rw.review_id
  AND (rw.business_key IS NULL OR rw.teacher_id IS NULL);
UPDATE private.upc_review_rewards rw
SET status = 'needs_verification'
WHERE NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = rw.review_id);
CREATE UNIQUE INDEX IF NOT EXISTS upc_review_rewards_business_key_uidx
  ON private.upc_review_rewards (business_key) WHERE business_key IS NOT NULL;
REVOKE ALL ON private.upc_review_rewards FROM PUBLIC, anon, authenticated;

-- Public per-offering statistics, already masked in the database layer. The
-- count is allowed to be public (1-4 are shown as insufficient sample), but
-- scores stay NULL until the configured independent-account threshold.
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS independent_reviewer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS rating_public BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.offering_rating_stats (
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  independent_reviewer_count INTEGER NOT NULL DEFAULT 0 CHECK (independent_reviewer_count >= 0),
  rating_public BOOLEAN NOT NULL DEFAULT false,
  attendance_strictness NUMERIC(3,1),
  grading_leniency NUMERIC(3,1),
  effort_matters NUMERIC(3,1),
  workload_difficulty NUMERIC(3,1),
  approachability NUMERIC(3,1),
  teaching_quality NUMERIC(3,1),
  overall_score NUMERIC(3,1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, course_id, term_id)
);
ALTER TABLE public.offering_rating_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offering_rating_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.offering_rating_stats TO anon, authenticated;
DROP POLICY IF EXISTS offering_rating_stats_public_read ON public.offering_rating_stats;
CREATE POLICY offering_rating_stats_public_read
  ON public.offering_rating_stats FOR SELECT
  USING (true);

-- Governance requests and immutable handling history. User-entered statements
-- stay private. The public queue never exposes applicant identity or evidence.
CREATE TABLE IF NOT EXISTS public.governance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL CHECK (request_type IN (
    'teacher_profile_correction', 'course_offering_correction',
    'review_report', 'review_withdrawal', 'account_deletion'
  )),
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_kind TEXT NOT NULL DEFAULT 'student'
    CHECK (requester_kind IN ('student', 'teacher', 'other', 'staff_proxy')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'staff_proxy')),
  target_teacher_id TEXT REFERENCES public.teachers(id) ON DELETE SET NULL,
  target_review_id TEXT REFERENCES public.reviews(id) ON DELETE SET NULL,
  target_course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  target_offering_id UUID REFERENCES public.course_offerings(id) ON DELETE SET NULL,
  statement TEXT NOT NULL CHECK (char_length(statement) BETWEEN 10 AND 2000),
  evidence_summary TEXT CHECK (evidence_summary IS NULL OR char_length(evidence_summary) <= 2000),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'triaged', 'in_review', 'accepted', 'rejected', 'withdrawn', 'completed'
  )),
  resolution TEXT CHECK (resolution IS NULL OR char_length(resolution) <= 2000),
  assigned_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  external_case_ref TEXT CHECK (external_case_ref IS NULL OR char_length(external_case_ref) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS governance_requests_requester_idx
  ON public.governance_requests (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS governance_requests_status_idx
  ON public.governance_requests (status, created_at);

CREATE TABLE IF NOT EXISTS private.upc_governance_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.governance_requests(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_admin_id UUID,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON private.upc_governance_events FROM PUBLIC, anon, authenticated;

-- BEGIN correction-closure-schema
-- Immutable write-back ledger for accepted teacher/course/offering corrections.
-- The applicant-visible request row only records status and resolution; the
-- actual before/after values, source basis and linked request live here.
CREATE TABLE IF NOT EXISTS private.upc_data_corrections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id UUID REFERENCES public.governance_requests(id) ON DELETE SET NULL,
  actor_user_id UUID,
  actor_admin_id UUID,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'course', 'offering')),
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('update', 'add', 'remove')),
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  source_basis TEXT NOT NULL CHECK (char_length(btrim(source_basis)) BETWEEN 10 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS upc_data_corrections_request_uidx
  ON private.upc_data_corrections (request_id);
CREATE INDEX IF NOT EXISTS upc_data_corrections_target_idx
  ON private.upc_data_corrections (target_type, target_id, created_at DESC);
REVOKE ALL ON private.upc_data_corrections FROM PUBLIC, anon, authenticated;

-- Fields already corrected through an accepted governance request. The import
-- RPC must not silently overwrite them; a protected field may only change via a
-- new, separately audited correction. course_offerings uses a deterministic
-- teacher|course|term key with field_name='relation' for a confirmed removal so
-- a later re-import cannot re-create the removed relation.
CREATE TABLE IF NOT EXISTS private.upc_correction_pins (
  target_table TEXT NOT NULL CHECK (target_table IN ('teachers', 'courses', 'course_offerings')),
  target_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  request_id UUID REFERENCES public.governance_requests(id) ON DELETE SET NULL,
  corrected_value JSONB,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_table, target_id, field_name)
);
REVOKE ALL ON private.upc_correction_pins FROM PUBLIC, anon, authenticated;

-- Account deletion removes the requester's governance request. Correction
-- records and pins are catalog-governance evidence, not applicant content, so
-- they survive with the request link nulled instead of blocking deletion.
ALTER TABLE private.upc_data_corrections ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE private.upc_data_corrections DROP CONSTRAINT IF EXISTS upc_data_corrections_request_id_fkey;
ALTER TABLE private.upc_data_corrections
  ADD CONSTRAINT upc_data_corrections_request_id_fkey
  FOREIGN KEY (request_id) REFERENCES public.governance_requests(id) ON DELETE SET NULL;
ALTER TABLE private.upc_correction_pins ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE private.upc_correction_pins DROP CONSTRAINT IF EXISTS upc_correction_pins_request_id_fkey;
ALTER TABLE private.upc_correction_pins
  ADD CONSTRAINT upc_correction_pins_request_id_fkey
  FOREIGN KEY (request_id) REFERENCES public.governance_requests(id) ON DELETE SET NULL;
-- END correction-closure-schema

-- Append-only administrative audit log. It never stores email addresses,
-- student identifiers or review text.
CREATE TABLE IF NOT EXISTS private.upc_admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID,
  actor_admin_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON private.upc_admin_audit_log FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS upc_admin_audit_created_idx
  ON private.upc_admin_audit_log (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION private.upc_audit_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '审计日志为只追加记录，不允许修改或删除';
END $$;
DROP TRIGGER IF EXISTS upc_admin_audit_immutable ON private.upc_admin_audit_log;
CREATE TRIGGER upc_admin_audit_immutable
  BEFORE UPDATE OR DELETE ON private.upc_admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION private.upc_audit_immutable();
REVOKE ALL ON FUNCTION private.upc_audit_immutable() FROM PUBLIC, anon, authenticated;
