-- UPC Auth guards, review eligibility/rate-limit triggers, score projection and
-- like RPC. Apply after security.sql and governance.sql.

-- ---------------------------------------------------------------------------
-- Student email policy: exact domain s.upc.edu.cn, no substring/suffix match.
-- Local parts (including school aliases with dots/plus) are preserved verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.upc_is_student_email(p_email TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_email IS NOT NULL
    AND char_length(btrim(p_email)) BETWEEN 3 AND 254
    AND btrim(p_email) ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$'
    AND split_part(btrim(p_email), '@', 2) <> ''
    AND split_part(btrim(p_email), '@', 2) !~ '@'
    AND position('..' IN split_part(btrim(p_email), '@', 1)) = 0
    AND left(split_part(btrim(p_email), '@', 1), 1) <> '.'
    AND right(split_part(btrim(p_email), '@', 1), 1) <> '.'
    AND lower(split_part(btrim(p_email), '@', 2)) = 's.upc.edu.cn'
$$;
REVOKE ALL ON FUNCTION private.upc_is_student_email(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.upc_is_admin_email(p_email TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_email IS NOT NULL
    AND char_length(btrim(p_email)) BETWEEN 3 AND 254
    AND btrim(p_email) ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$'
    AND split_part(btrim(p_email), '@', 2) <> ''
    AND position('..' IN split_part(btrim(p_email), '@', 1)) = 0
    AND left(split_part(btrim(p_email), '@', 1), 1) <> '.'
    AND right(split_part(btrim(p_email), '@', 1), 1) <> '.'
    AND lower(split_part(btrim(p_email), '@', 2)) = 'gmail.com'
$$;
REVOKE ALL ON FUNCTION private.upc_is_admin_email(TEXT) FROM PUBLIC, anon, authenticated;

-- Gmail is not self-service. Only an unexpired, unused invite
-- created by an authorized operator permits the account creation path.
CREATE OR REPLACE FUNCTION private.upc_admin_invite_ok(p_email TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.upc_is_admin_email(p_email) AND EXISTS (
    SELECT 1 FROM private.upc_admin_invites i
    WHERE i.email = lower(btrim(p_email))
      AND i.used_at IS NULL
      AND i.expires_at > now()
  )
$$;
REVOKE ALL ON FUNCTION private.upc_admin_invite_ok(TEXT) FROM PUBLIC, anon, authenticated;

-- Before User Created Hook. The function is executable only by the Auth role;
-- it never trusts user_metadata or frontend-supplied flags.
CREATE OR REPLACE FUNCTION public.before_user_created_hook(event JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email TEXT := event->'user'->>'email';
BEGIN
  IF NOT private.upc_is_student_email(v_email)
     AND NOT private.upc_admin_invite_ok(v_email) THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', '仅限中国石油大学（华东）学生邮箱（@s.upc.edu.cn）注册；管理员须使用受控邀请'
    ));
  END IF;
  RETURN event;
END $$;
REVOKE ALL ON FUNCTION public.before_user_created_hook(JSONB) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.before_user_created_hook(JSONB) TO supabase_auth_admin;
  END IF;
END $$;

-- Email update/insert guard. This is intentionally separate from the creation
-- hook: updating auth.users.email or auth.users.email_change must not bypass it.
CREATE OR REPLACE FUNCTION private.upc_guard_auth_email() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_change TEXT; v_part TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.upc_is_student_email(NEW.email)
       AND NOT private.upc_admin_invite_ok(NEW.email) THEN
      RAISE EXCEPTION '仅限中国石油大学（华东）学生邮箱（@s.upc.edu.cn）注册；管理员须使用受控邀请';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    -- A legacy non-student account may read its own profile and request
    -- deletion, but cannot convert itself into a new review-eligible account.
    IF NOT private.upc_is_student_email(OLD.email) THEN
      RAISE EXCEPTION '历史非学生账户不允许变更邮箱，请提交账户删除申请';
    END IF;
    IF NOT private.upc_is_student_email(NEW.email) THEN
      RAISE EXCEPTION '邮箱变更仅允许 @s.upc.edu.cn 学生邮箱';
    END IF;
  END IF;

  v_change := to_jsonb(NEW)->>'email_change';
  IF v_change IS DISTINCT FROM to_jsonb(OLD)->>'email_change'
     AND nullif(btrim(v_change), '') IS NOT NULL THEN
    IF NOT private.upc_is_student_email(OLD.email) THEN
      RAISE EXCEPTION '历史非学生账户不允许发起邮箱变更';
    END IF;
    FOR v_part IN SELECT btrim(part) FROM regexp_split_to_table(v_change, ',') part
    LOOP
      IF v_part <> '' AND NOT private.upc_is_student_email(v_part) THEN
        RAISE EXCEPTION '邮箱变更仅允许 @s.upc.edu.cn 学生邮箱';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_guard_auth_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS upc_guard_auth_email ON auth.users;
CREATE TRIGGER upc_guard_auth_email
  BEFORE INSERT OR UPDATE OF email, email_change ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.upc_guard_auth_email();

CREATE OR REPLACE FUNCTION private.upc_consume_admin_invite() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.upc_admin_invites
  SET used_at = now()
  WHERE email = lower(NEW.email) AND used_at IS NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_consume_admin_invite() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS upc_consume_admin_invite ON auth.users;
CREATE TRIGGER upc_consume_admin_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.upc_consume_admin_invite();

-- ---------------------------------------------------------------------------
-- Review eligibility, server time, closed text comments and atomic rate limit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.upc_assert_review_account(p_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email TEXT; v_confirmed TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION '评价必须关联当前登录账户'; END IF;
  SELECT email, email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users WHERE id::text = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '评价账户不存在'; END IF;
  IF v_confirmed IS NULL THEN RAISE EXCEPTION '请先完成学生邮箱验证'; END IF;
  IF NOT private.upc_is_student_email(v_email) THEN
    RAISE EXCEPTION '仅已验证学生邮箱账户可提交评价';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.upc_assert_review_account(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.upc_enforce_review_rate(
  p_user_id TEXT, p_review_id TEXT, p_teacher_id TEXT,
  p_course_id UUID, p_term_id UUID
) RETURNS TEXT[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date;
  v_window_seconds INTEGER := 60;
  v_daily INTEGER := 10;
  v_burst_window INTEGER := 60;
  v_burst_users INTEGER := 5;
  v_window_started TIMESTAMPTZ;
  v_window_count INTEGER;
  v_day DATE;
  v_day_count INTEGER;
  v_burst INTEGER;
  v_recent INTEGER;
  v_flags TEXT[] := '{}';
BEGIN
  SELECT coalesce((value #>> '{}')::int, 60) INTO v_window_seconds
  FROM private.upc_security_settings WHERE key = 'review_rate_seconds';
  SELECT coalesce((value #>> '{}')::int, 10) INTO v_daily
  FROM private.upc_security_settings WHERE key = 'review_daily_limit';
  SELECT coalesce((value #>> '{}')::int, 60) INTO v_burst_window
  FROM private.upc_security_settings WHERE key = 'offering_burst_window_minutes';
  SELECT coalesce((value #>> '{}')::int, 5) INTO v_burst_users
  FROM private.upc_security_settings WHERE key = 'offering_burst_unique_users';

  INSERT INTO private.upc_review_rate_limits
    (user_id, window_started_at, window_count, day_bucket, day_count, last_review_id, last_submitted_at)
  VALUES (p_user_id, v_now, 0, v_today, 0, p_review_id, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT window_started_at, window_count, day_bucket, day_count
  INTO v_window_started, v_window_count, v_day, v_day_count
  FROM private.upc_review_rate_limits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_window_seconds > 0 AND v_now < v_window_started + make_interval(secs => v_window_seconds)
     AND v_window_count >= 1 THEN
    RAISE EXCEPTION '提交过于频繁，请 % 秒后再试', greatest(1, ceil(extract(epoch FROM
      (v_window_started + make_interval(secs => v_window_seconds) - v_now))))::int;
  END IF;
  IF v_day = v_today AND v_day_count >= v_daily THEN
    RAISE EXCEPTION '24 小时内评价提交次数已达上限';
  END IF;

  SELECT count(DISTINCT r.user_id) INTO v_burst
  FROM public.reviews r
  WHERE r.teacher_id = p_teacher_id
    AND r.course_id = p_course_id
    AND r.term_id = p_term_id
    AND r.created_at >= v_now - make_interval(mins => v_burst_window);
  IF v_burst + 1 >= v_burst_users THEN
    v_flags := array_append(v_flags, 'offering_burst');
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.reviews r
  WHERE r.user_id = p_user_id AND r.created_at >= v_now - interval '24 hours';
  IF v_recent >= 2 THEN
    v_flags := array_append(v_flags, 'repeat_pending_pattern');
  END IF;

  UPDATE private.upc_review_rate_limits
  SET window_started_at = CASE WHEN v_now < v_window_started + make_interval(secs => v_window_seconds)
        THEN v_window_started ELSE v_now END,
      window_count = CASE WHEN v_now < v_window_started + make_interval(secs => v_window_seconds)
        THEN v_window_count + 1 ELSE 1 END,
      day_bucket = v_today,
      day_count = CASE WHEN v_day = v_today THEN v_day_count + 1 ELSE 1 END,
      last_review_id = p_review_id,
      last_submitted_at = v_now
  WHERE user_id = p_user_id;

  RETURN v_flags;
END $$;
REVOKE ALL ON FUNCTION private.upc_enforce_review_rate(TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.upc_guard_review_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_flags TEXT[];
BEGIN
  IF NEW.is_historical_migrated THEN
    RETURN NEW;
  END IF;

  -- Submission eligibility applies to new reviews and to the author editing
  -- their own review. A moderator approving/rejecting/withdrawing a historical
  -- non-student review is a governance action, not a new submission, and must
  -- not be blocked by the reviewer's legacy email domain.
  IF TG_OP = 'INSERT'
     OR (auth.uid() IS NOT NULL AND auth.uid()::text = NEW.user_id) THEN
    PERFORM private.upc_assert_review_account(NEW.user_id);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Client timestamps are not a rate-limit clock and are never trusted.
    NEW.created_at := clock_timestamp();
    NEW.is_public := true;
    NEW.withdrawn_at := NULL;
  END IF;

  IF nullif(btrim(coalesce(NEW.comment, '')), '') IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.comment IS DISTINCT FROM OLD.comment) THEN
    RAISE EXCEPTION '文字评论未开放，请仅提交六维评分';
  END IF;

  -- Inside a SECURITY DEFINER trigger current_user is the function owner, so
  -- the authenticated caller is identified by auth.uid() instead. Service-role
  -- maintenance inserts without a user claim are not treated as user submits.
  IF auth.uid() IS NOT NULL
     AND auth.uid()::text = NEW.user_id
     AND NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending') THEN
    v_flags := private.upc_enforce_review_rate(
      NEW.user_id, NEW.id, NEW.teacher_id, NEW.course_id, NEW.term_id
    );
    NEW.risk_flags := coalesce(NEW.risk_flags, '{}') || v_flags;
    IF cardinality(v_flags) > 0 THEN
      NEW.risk_reason := concat_ws('；',
        CASE WHEN 'offering_burst' = ANY(v_flags)
          THEN '同一教师×课程×学期短时出现多名账户集中提交' END,
        CASE WHEN 'repeat_pending_pattern' = ANY(v_flags)
          THEN '该账户 24 小时内存在重复提交模式' END
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_guard_review_write() FROM PUBLIC, anon, authenticated;
-- BEGIN review-write-trigger
DROP TRIGGER IF EXISTS reviews_guard_business ON public.reviews;
CREATE TRIGGER reviews_guard_business
  BEFORE INSERT OR UPDATE OF status, teacher_id, course_id, term_id, user_id, comment,
    rating_version, attendance_strictness, grading_leniency, effort_matters,
    workload_difficulty, approachability, teaching_quality
  ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION private.upc_guard_review_write();
-- END review-write-trigger

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.upc_ensure_profile(NEW.id::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION private.upc_touch_teacher() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_touch_teacher() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS teachers_touch_updated_at ON public.teachers;
CREATE TRIGGER teachers_touch_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION private.upc_touch_teacher();

-- Recompute offering statistics and the teacher aggregate. Public scores are
-- written as NULL until the independent-account threshold is reached. The
-- private count is still used internally.
CREATE OR REPLACE FUNCTION public.recalc_teacher_scores() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target_teacher_id TEXT;
  v_min INTEGER := 5;
  v_count INTEGER;
  v_independent INTEGER;
  v_public BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_teacher_id := OLD.teacher_id;
  ELSE
    target_teacher_id := NEW.teacher_id;
  END IF;

  SELECT coalesce((value #>> '{}')::int, 5) INTO v_min
  FROM private.upc_security_settings WHERE key = 'min_independent_reviews';

  DELETE FROM public.offering_rating_stats WHERE teacher_id = target_teacher_id;

  INSERT INTO public.offering_rating_stats (
    teacher_id, course_id, term_id, review_count, independent_reviewer_count,
    rating_public, attendance_strictness, grading_leniency, effort_matters,
    workload_difficulty, approachability, teaching_quality, overall_score, updated_at
  )
  SELECT
    r.teacher_id, r.course_id, r.term_id, count(*)::int,
    count(DISTINCT r.user_id)::int,
    count(DISTINCT r.user_id) >= v_min,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.attendance_strictness) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.grading_leniency) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.effort_matters) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.workload_difficulty) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.approachability) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.teaching_quality) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(
      (coalesce(r.attendance_strictness, 0) + coalesce(r.grading_leniency, 0) +
       coalesce(r.effort_matters, 0) + coalesce(r.workload_difficulty, 0) +
       coalesce(r.approachability, 0) + coalesce(r.teaching_quality, 0)) /
      nullif(
        (r.attendance_strictness IS NOT NULL)::int + (r.grading_leniency IS NOT NULL)::int +
        (r.effort_matters IS NOT NULL)::int + (r.workload_difficulty IS NOT NULL)::int +
        (r.approachability IS NOT NULL)::int + (r.teaching_quality IS NOT NULL)::int,
        0
      )
    ) END,
    now()
  FROM public.reviews r
  WHERE r.teacher_id = target_teacher_id
    AND r.status = 'approved' AND r.is_public
  GROUP BY r.teacher_id, r.course_id, r.term_id;

  SELECT count(*)::int, count(DISTINCT r.user_id)::int
  INTO v_count, v_independent
  FROM public.reviews r
  WHERE r.teacher_id = target_teacher_id AND r.status = 'approved' AND r.is_public;
  v_public := coalesce(v_independent, 0) >= v_min;

  UPDATE public.teachers t
  SET
    review_count = coalesce(v_count, 0),
    independent_reviewer_count = coalesce(v_independent, 0),
    rating_public = v_public,
    attendance_strictness = CASE WHEN v_public THEN a.attendance_strictness END,
    grading_leniency = CASE WHEN v_public THEN a.grading_leniency END,
    effort_matters = CASE WHEN v_public THEN a.effort_matters END,
    workload_difficulty = CASE WHEN v_public THEN a.workload_difficulty END,
    approachability = CASE WHEN v_public THEN a.approachability END,
    teaching_quality = CASE WHEN v_public THEN a.teaching_quality END,
    overall_score = CASE WHEN v_public THEN a.overall_score END,
    updated_at = now()
  FROM (
    SELECT
      avg(r.attendance_strictness) AS attendance_strictness,
      avg(r.grading_leniency) AS grading_leniency,
      avg(r.effort_matters) AS effort_matters,
      avg(r.workload_difficulty) AS workload_difficulty,
      avg(r.approachability) AS approachability,
      avg(r.teaching_quality) AS teaching_quality,
      avg(
        (coalesce(r.attendance_strictness, 0) + coalesce(r.grading_leniency, 0) +
         coalesce(r.effort_matters, 0) + coalesce(r.workload_difficulty, 0) +
         coalesce(r.approachability, 0) + coalesce(r.teaching_quality, 0)) /
        nullif(
          (r.attendance_strictness IS NOT NULL)::int + (r.grading_leniency IS NOT NULL)::int +
          (r.effort_matters IS NOT NULL)::int + (r.workload_difficulty IS NOT NULL)::int +
          (r.approachability IS NOT NULL)::int + (r.teaching_quality IS NOT NULL)::int,
          0
        )
      ) AS overall_score
    FROM public.reviews r
    WHERE r.teacher_id = target_teacher_id AND r.status = 'approved' AND r.is_public
  ) a
  WHERE t.id = target_teacher_id;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.recalc_teacher_scores() FROM PUBLIC, anon, authenticated;

-- One-time/rebuild projection for existing rows. The trigger above only touches
-- the changed teacher; this keeps all historical aggregates fail-closed and
-- removes any pre-migration precision/score that predates the 5-person rule.
CREATE OR REPLACE FUNCTION private.upc_rebuild_public_ratings() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_min INTEGER := 5;
BEGIN
  SELECT coalesce((value #>> '{}')::int, 5) INTO v_min
  FROM private.upc_security_settings WHERE key = 'min_independent_reviews';

  DELETE FROM public.offering_rating_stats;
  INSERT INTO public.offering_rating_stats (
    teacher_id, course_id, term_id, review_count, independent_reviewer_count,
    rating_public, attendance_strictness, grading_leniency, effort_matters,
    workload_difficulty, approachability, teaching_quality, overall_score, updated_at
  )
  SELECT
    r.teacher_id, r.course_id, r.term_id, count(*)::int,
    count(DISTINCT r.user_id)::int,
    count(DISTINCT r.user_id) >= v_min,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.attendance_strictness) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.grading_leniency) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.effort_matters) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.workload_difficulty) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.approachability) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(r.teaching_quality) END,
    CASE WHEN count(DISTINCT r.user_id) >= v_min THEN avg(
      (coalesce(r.attendance_strictness, 0) + coalesce(r.grading_leniency, 0) +
       coalesce(r.effort_matters, 0) + coalesce(r.workload_difficulty, 0) +
       coalesce(r.approachability, 0) + coalesce(r.teaching_quality, 0)) /
      nullif(
        (r.attendance_strictness IS NOT NULL)::int + (r.grading_leniency IS NOT NULL)::int +
        (r.effort_matters IS NOT NULL)::int + (r.workload_difficulty IS NOT NULL)::int +
        (r.approachability IS NOT NULL)::int + (r.teaching_quality IS NOT NULL)::int,
        0
      )
    ) END,
    now()
  FROM public.reviews r
  WHERE r.status = 'approved' AND r.is_public
  GROUP BY r.teacher_id, r.course_id, r.term_id;

  UPDATE public.teachers
  SET review_count = 0,
      independent_reviewer_count = 0,
      rating_public = false,
      attendance_strictness = NULL,
      grading_leniency = NULL,
      effort_matters = NULL,
      workload_difficulty = NULL,
      approachability = NULL,
      teaching_quality = NULL,
      overall_score = NULL,
      updated_at = now();

  UPDATE public.teachers t
  SET review_count = a.review_count,
      independent_reviewer_count = a.independent_reviewer_count,
      rating_public = a.independent_reviewer_count >= v_min,
      attendance_strictness = CASE WHEN a.independent_reviewer_count >= v_min THEN a.attendance_strictness END,
      grading_leniency = CASE WHEN a.independent_reviewer_count >= v_min THEN a.grading_leniency END,
      effort_matters = CASE WHEN a.independent_reviewer_count >= v_min THEN a.effort_matters END,
      workload_difficulty = CASE WHEN a.independent_reviewer_count >= v_min THEN a.workload_difficulty END,
      approachability = CASE WHEN a.independent_reviewer_count >= v_min THEN a.approachability END,
      teaching_quality = CASE WHEN a.independent_reviewer_count >= v_min THEN a.teaching_quality END,
      overall_score = CASE WHEN a.independent_reviewer_count >= v_min THEN a.overall_score END,
      updated_at = now()
  FROM (
    SELECT
      r.teacher_id,
      count(*)::int AS review_count,
      count(DISTINCT r.user_id)::int AS independent_reviewer_count,
      avg(r.attendance_strictness) AS attendance_strictness,
      avg(r.grading_leniency) AS grading_leniency,
      avg(r.effort_matters) AS effort_matters,
      avg(r.workload_difficulty) AS workload_difficulty,
      avg(r.approachability) AS approachability,
      avg(r.teaching_quality) AS teaching_quality,
      avg(
        (coalesce(r.attendance_strictness, 0) + coalesce(r.grading_leniency, 0) +
         coalesce(r.effort_matters, 0) + coalesce(r.workload_difficulty, 0) +
         coalesce(r.approachability, 0) + coalesce(r.teaching_quality, 0)) /
        nullif(
          (r.attendance_strictness IS NOT NULL)::int + (r.grading_leniency IS NOT NULL)::int +
          (r.effort_matters IS NOT NULL)::int + (r.workload_difficulty IS NOT NULL)::int +
          (r.approachability IS NOT NULL)::int + (r.teaching_quality IS NOT NULL)::int,
          0
        )
      ) AS overall_score
    FROM public.reviews r
    WHERE r.status = 'approved' AND r.is_public
    GROUP BY r.teacher_id
  ) a
  WHERE t.id = a.teacher_id;
END $$;
REVOKE ALL ON FUNCTION private.upc_rebuild_public_ratings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recalc_teacher_scores ON public.reviews;
CREATE TRIGGER trg_recalc_teacher_scores
  AFTER INSERT OR DELETE OR UPDATE OF status, is_public, teacher_id, attendance_strictness,
    grading_leniency, effort_matters, workload_difficulty, approachability, teaching_quality
  ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recalc_teacher_scores();

-- Reject v1 clients and out-of-range values before they can be stored.
CREATE OR REPLACE FUNCTION private.upc_check_rating_version() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.rating_version IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '评分规则已更新，请刷新页面后重试';
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-rating-version', '') <> '2' THEN
    RAISE EXCEPTION '评分规则已更新，请刷新页面后重试';
  END IF;
  IF NEW.is_historical_migrated = false THEN
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        NEW.attendance_strictness, NEW.grading_leniency, NEW.effort_matters,
        NEW.workload_difficulty, NEW.approachability, NEW.teaching_quality
      ]) s WHERE s IS NULL
    ) THEN
      RAISE EXCEPTION '六项评分均为必填';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        NEW.attendance_strictness, NEW.grading_leniency, NEW.effort_matters,
        NEW.workload_difficulty, NEW.approachability, NEW.teaching_quality
      ]) s
      WHERE s < 4 OR s > 5 OR s <> round(s, 1)
    ) THEN
      RAISE EXCEPTION '新提交评分须在 4.0 到 5.0 之间，最多一位小数';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      NEW.attendance_strictness, NEW.grading_leniency, NEW.effort_matters,
      NEW.workload_difficulty, NEW.approachability, NEW.teaching_quality
    ]) s
    WHERE s IS NOT NULL AND NOT (s BETWEEN 1 AND 5)
  ) THEN
    RAISE EXCEPTION '历史评分必须在 1 到 5 分之间';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_check_rating_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reviews_check_rating_version ON public.reviews;
CREATE TRIGGER reviews_check_rating_version
  BEFORE INSERT OR UPDATE OF rating_version, attendance_strictness, grading_leniency,
    effort_matters, workload_difficulty, approachability, teaching_quality
  ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION private.upc_check_rating_version();

CREATE OR REPLACE FUNCTION private.upc_count_review_like() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reviews SET likes = coalesce(likes, 0) + 1 WHERE id = NEW.review_id;
  ELSE
    UPDATE public.reviews
    SET likes = greatest(legacy_likes, coalesce(likes, 0) - 1)
    WHERE id = OLD.review_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.upc_count_review_like() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS review_likes_count ON public.review_likes;
CREATE TRIGGER review_likes_count
  AFTER INSERT OR DELETE ON public.review_likes
  FOR EACH ROW EXECUTE FUNCTION private.upc_count_review_like();

CREATE OR REPLACE FUNCTION public.set_review_like(p_review_id TEXT, p_liked BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID := auth.uid(); review_status TEXT; review_teacher_id TEXT; total INTEGER;
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '请先登录后点赞';
  END IF;
  IF p_liked IS NULL THEN RAISE EXCEPTION '请明确点赞或取消点赞'; END IF;
  SELECT status, teacher_id INTO review_status, review_teacher_id
  FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '评价不存在'; END IF;
  IF p_liked AND review_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION '只能点赞已通过审核的评价';
  END IF;
  IF p_liked THEN
    INSERT INTO public.review_likes (review_id, user_id)
    VALUES (p_review_id, uid)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.review_likes WHERE review_id = p_review_id AND user_id = uid;
  END IF;
  SELECT likes INTO total FROM public.reviews WHERE id = p_review_id;
  RETURN jsonb_build_object('likes', total, 'liked', p_liked, 'teacher_id', review_teacher_id);
END $$;
REVOKE ALL ON FUNCTION public.set_review_like(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_review_like(TEXT, BOOLEAN) TO authenticated;

-- Existing databases must not retain pre-migration scores during the window
-- before the next review write. This is a derived-data rebuild only.
SELECT private.upc_rebuild_public_ratings();

NOTIFY pgrst, 'reload schema';
