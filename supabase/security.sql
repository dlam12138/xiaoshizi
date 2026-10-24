-- UPC authorization, public projections and RPC layer.
-- Apply after base-schema.sql and security-schema.sql.
--
-- Public review reads use review_feed. Base review rows are readable only by
-- their author; reviewers use admin_review_queue without the author subject.
-- Public teacher aggregates are masked by recalc_teacher_scores / the offering
-- statistics table before they are written.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- A JWT remains cryptographically valid until expiry even after its Auth
-- session is deleted. Administrator checks must therefore bind the presented
-- access token to a live auth.sessions row, not only to the account, role and
-- aal claim. A missing/unknown session_id fails closed.
CREATE OR REPLACE FUNCTION private.upc_session_is_current() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.user_id = auth.uid()
      AND s.id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'session_id')::uuid
  )
$$;
REVOKE ALL ON FUNCTION private.upc_session_is_current() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.upc_admin_record() RETURNS public.admin_users
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a
  FROM public.admin_users a
  JOIN auth.users u ON u.id = a.user_id
  WHERE u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL
    AND a.is_active
    AND a.role IN ('super_admin', 'admin', 'moderator')
    AND private.upc_session_is_current()
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.upc_admin_record() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.upc_admin_record() TO authenticated;

CREATE OR REPLACE FUNCTION private.upc_admin_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (private.upc_admin_record()).role
$$;
REVOKE ALL ON FUNCTION private.upc_admin_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.upc_admin_role() TO authenticated;

CREATE OR REPLACE FUNCTION private.upc_has_aal2() RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', 'aal1') = 'aal2'
$$;
REVOKE ALL ON FUNCTION private.upc_has_aal2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.upc_has_aal2() TO authenticated;

CREATE OR REPLACE FUNCTION private.upc_require_admin() RETURNS public.admin_users
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users;
BEGIN
  v_admin := private.upc_admin_record();
  IF v_admin.id IS NULL THEN RAISE EXCEPTION '无审核权限'; END IF;
  IF coalesce((SELECT (value)::boolean FROM private.upc_security_settings WHERE key = 'require_admin_aal2'), false)
     AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', 'aal1') <> 'aal2'
  THEN
    RAISE EXCEPTION '管理员敏感操作需要 AAL2 强验证，请先完成 MFA';
  END IF;
  RETURN v_admin;
END $$;
REVOKE ALL ON FUNCTION private.upc_require_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.upc_require_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_admin_status() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'is_admin', true, 'role', a.role, 'nickname', a.nickname,
      'can_investigate_identity', a.can_investigate_identity,
      'completed_aal2', coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', 'aal1') = 'aal2',
      'mfa_required', coalesce((SELECT (value)::boolean FROM private.upc_security_settings WHERE key = 'require_admin_aal2'), true)
    )
    FROM public.admin_users a
    JOIN auth.users u ON u.id = a.user_id
    WHERE u.id = auth.uid()
      AND u.email_confirmed_at IS NOT NULL
      AND a.is_active
      AND a.role IN ('super_admin', 'admin', 'moderator')
      AND private.upc_session_is_current()
    LIMIT 1
  ), jsonb_build_object('is_admin', false))
$$;

-- Replace all historical policies: permissive policies combine with OR.
DO $$
DECLARE v RECORD; tbl TEXT;
BEGIN
  FOR v IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('teachers','reviews','review_likes','user_profiles','point_transactions',
                        'admin_users','courses','colleges','terms','course_offerings','point_rules',
                        'import_batches','offering_rating_stats','governance_requests')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v.policyname, v.tablename);
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['teachers','reviews','review_likes','user_profiles','point_transactions',
                             'admin_users','courses','colleges','terms','course_offerings','point_rules',
                             'import_batches','offering_rating_stats','governance_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tbl);
  END LOOP;
END $$;

GRANT SELECT ON public.teachers, public.courses, public.colleges, public.terms,
  public.course_offerings, public.point_rules TO anon, authenticated;
CREATE POLICY catalog_read ON public.teachers FOR SELECT USING (true);
CREATE POLICY catalog_read ON public.courses FOR SELECT USING (true);
CREATE POLICY catalog_read ON public.colleges FOR SELECT USING (true);
CREATE POLICY catalog_read ON public.terms FOR SELECT USING (true);
CREATE POLICY catalog_read ON public.course_offerings FOR SELECT USING (true);
CREATE POLICY catalog_read ON public.point_rules FOR SELECT USING (true);
CREATE POLICY offering_rating_stats_public_read ON public.offering_rating_stats FOR SELECT USING (true);

-- Public approved-review projection. No comment, applicant identity, exact
-- timestamp or review moderation data. Time is week-coarsened; "created_week"
-- is the only public time field.
DROP VIEW IF EXISTS public.review_feed;
CREATE VIEW public.review_feed AS
SELECT
  r.id, r.teacher_id, r.course_id, r.term_id, r.year_term,
  r.attendance_strictness, r.grading_leniency, r.effort_matters,
  r.workload_difficulty, r.approachability, r.teaching_quality,
  '匿名石大学子'::text AS author_nickname,
  'approved'::text AS status,
  date_trunc('week', r.created_at)::date AS created_week,
  r.likes, r.rating_version,
  c.name AS course_name,
  t.name AS teacher_name
FROM public.reviews r
LEFT JOIN public.courses c ON c.id = r.course_id
LEFT JOIN public.teachers t ON t.id = r.teacher_id
WHERE r.status = 'approved'
  AND r.is_public
  AND EXISTS (
    SELECT 1
    FROM public.offering_rating_stats s
    WHERE s.teacher_id = r.teacher_id
      AND s.course_id = r.course_id
      AND s.term_id = r.term_id
      AND s.rating_public
  );
REVOKE ALL ON public.review_feed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_feed TO anon, authenticated;

-- Authors may read their own base rows. Reviewers read the controlled queue,
-- which deliberately omits user_id/email and exposes only moderation fields.
GRANT SELECT ON public.reviews TO authenticated;
CREATE POLICY reviews_member_read ON public.reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

DROP VIEW IF EXISTS public.admin_review_queue;
CREATE VIEW public.admin_review_queue AS
SELECT
  r.id, r.teacher_id, t.name AS teacher_name,
  r.course_id, c.name AS course_name, r.term_id, r.year_term,
  r.attendance_strictness, r.grading_leniency, r.effort_matters,
  r.workload_difficulty, r.approachability, r.teaching_quality,
  r.comment, r.status, r.reject_reason, r.reviewer_id,
  r.reviewed_at, r.created_at, r.likes, r.rating_version,
  r.is_historical_migrated, r.is_public, r.withdrawn_at,
  r.risk_flags, r.risk_reason,
  a.nickname AS reviewer_nickname
FROM public.reviews r
LEFT JOIN public.teachers t ON t.id = r.teacher_id
LEFT JOIN public.courses c ON c.id = r.course_id
LEFT JOIN public.admin_users a ON a.id = r.reviewer_id
WHERE (private.upc_admin_record()).id IS NOT NULL AND private.upc_has_aal2();
REVOKE ALL ON public.admin_review_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_review_queue TO authenticated;

-- Column-level write grants intentionally omit comment. Historical comments
-- remain readable by their author/reviewer but no new text can be written.
GRANT INSERT (id, teacher_id, course_id, term_id, year_term,
  attendance_strictness, grading_leniency, effort_matters, workload_difficulty,
  approachability, teaching_quality, author_nickname, user_id,
  is_historical_migrated, status, created_at, likes, rating_version)
  ON public.reviews TO authenticated;
GRANT UPDATE (course_id, term_id, year_term, attendance_strictness, grading_leniency,
  effort_matters, workload_difficulty, approachability, teaching_quality,
  status, reject_reason, rating_version)
  ON public.reviews TO authenticated;
GRANT DELETE ON public.reviews TO authenticated;

CREATE POLICY reviews_submit ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND status = 'pending'
    AND NOT is_historical_migrated
    AND likes = 0
    AND reviewer_id IS NULL
    AND reviewed_at IS NULL
    AND reject_reason IS NULL
    AND is_public
    AND rating_version = 2
    AND comment IS NULL
    AND author_nickname = '匿名石大学子'
    AND EXISTS (
      SELECT 1 FROM public.course_offerings o
      WHERE o.teacher_id = reviews.teacher_id
        AND o.course_id = reviews.course_id
        AND o.term_id = reviews.term_id
    )
  );
CREATE POLICY reviews_author_edit ON public.reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text AND status IN ('pending', 'rejected'))
  WITH CHECK (
    user_id = auth.uid()::text
    AND status = 'pending'
    AND rating_version = 2
    AND comment IS NULL
    AND author_nickname = '匿名石大学子'
    AND is_public
    AND EXISTS (
      SELECT 1 FROM public.course_offerings o
      WHERE o.teacher_id = reviews.teacher_id
        AND o.course_id = reviews.course_id
        AND o.term_id = reviews.term_id
    )
  );
CREATE POLICY reviews_delete ON public.reviews FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text AND status IN ('pending', 'rejected'));

GRANT SELECT ON public.user_profiles, public.point_transactions TO authenticated;
CREATE POLICY points_owner_read ON public.user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid()::text);
CREATE POLICY ledger_owner_read ON public.point_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

GRANT SELECT ON public.review_likes TO authenticated;
CREATE POLICY likes_read_own ON public.review_likes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Administrator management is service-side RPC only. Base admin rows and email
-- addresses are not exposed to the browser.
DROP VIEW IF EXISTS public.admin_directory;
CREATE VIEW public.admin_directory AS
SELECT a.id, a.user_id, a.nickname, a.role, a.is_active,
       a.can_investigate_identity, a.created_at
FROM public.admin_users a
WHERE private.upc_admin_role() = 'super_admin' AND private.upc_has_aal2();
REVOKE ALL ON public.admin_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_directory TO authenticated;

-- No import_batches policy: the table is service-role only.

CREATE OR REPLACE FUNCTION private.upc_ensure_profile(p_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE inserted_id TEXT; initial_points INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text = p_user_id) THEN
    RAISE EXCEPTION 'Unknown authenticated user';
  END IF;
  SELECT points_delta INTO initial_points
  FROM public.point_rules
  WHERE action_code = 'new_user_welcome' AND is_active;
  IF initial_points IS NULL OR initial_points < 0 THEN
    RAISE EXCEPTION '注册积分规则不可用';
  END IF;
  INSERT INTO public.user_profiles (id, points)
  VALUES (p_user_id, initial_points)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN
    INSERT INTO public.point_transactions (id, user_id, action, action_code, amount, balance_after)
    VALUES (gen_random_uuid()::text, p_user_id, '新用户注册赠送', 'new_user_welcome', initial_points, initial_points);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.upc_ensure_profile(TEXT) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.handle_daily_checkin();
CREATE FUNCTION public.handle_daily_checkin()
RETURNS TABLE(points INTEGER, already_checked_in BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid TEXT := auth.uid()::text;
  bal INTEGER;
  last_day DATE;
  reward INTEGER;
  today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
  PERFORM private.upc_ensure_profile(uid);
  SELECT p.points, p.last_checkin_date INTO bal, last_day
  FROM public.user_profiles p WHERE p.id = uid FOR UPDATE;
  IF last_day = today THEN
    RETURN QUERY SELECT bal, true;
    RETURN;
  END IF;
  SELECT pr.points_delta INTO reward
  FROM public.point_rules pr
  WHERE pr.action_code = 'daily_checkin' AND pr.is_active;
  IF reward IS NULL OR reward <= 0 THEN RAISE EXCEPTION '签到积分规则不可用'; END IF;
  UPDATE public.user_profiles p
  SET points = p.points + reward, last_checkin_date = today
  WHERE id = uid
  RETURNING p.points INTO bal;
  INSERT INTO public.point_transactions (id, user_id, action, action_code, amount, balance_after)
  VALUES (gen_random_uuid()::text, uid, '每日签到奖励', 'daily_checkin', reward, bal);
  RETURN QUERY SELECT bal, false;
END $$;

-- Generic rule-based deduction. There is no hard-coded AI/feature allow-list:
-- only active negative rules can be spent, and phase-one has no active spend rule.
CREATE OR REPLACE FUNCTION public.spend_points(p_action_code TEXT, p_note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid TEXT := auth.uid()::text; bal INTEGER; cost INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
  SELECT pr.points_delta INTO cost
  FROM public.point_rules pr
  WHERE pr.action_code = p_action_code AND pr.is_active;
  IF cost IS NULL OR cost >= 0 THEN RAISE EXCEPTION '积分消费规则不可用'; END IF;
  PERFORM private.upc_ensure_profile(uid);
  SELECT points INTO bal FROM public.user_profiles WHERE id = uid FOR UPDATE;
  IF bal + cost < 0 THEN RAISE EXCEPTION 'insufficient points: 积分不足'; END IF;
  UPDATE public.user_profiles p SET points = p.points + cost WHERE id = uid RETURNING p.points INTO bal;
  INSERT INTO public.point_transactions (id, user_id, action, action_code, amount, balance_after)
  VALUES (gen_random_uuid()::text, uid, coalesce(p_note, '积分消费'), p_action_code, cost, bal);
  RETURN bal;
END $$;

CREATE OR REPLACE FUNCTION private.upc_write_audit(
  p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users;
BEGIN
  v_admin := private.upc_require_admin();
  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), v_admin.id, p_action, p_target_type, p_target_id, p_reason, p_metadata);
END $$;
REVOKE ALL ON FUNCTION private.upc_write_audit(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.upc_write_audit(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- Approval, reward and audit are one transaction. The durable marker uses the
-- user x teacher x course x term business key, so a new review ID cannot replay
-- a reward. Orphaned legacy rewards are conservatively held for verification.
DROP FUNCTION IF EXISTS public.approve_review(TEXT);
CREATE FUNCTION public.approve_review(p_review_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rev public.reviews%ROWTYPE;
  bal INTEGER;
  inserted_key TEXT;
  v_admin public.admin_users;
  reward INTEGER;
  v_business_key TEXT;
  v_needs_verification BOOLEAN;
BEGIN
  v_admin := private.upc_require_admin();
  SELECT * INTO rev FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', '评价不存在'); END IF;
  IF rev.status = 'approved' THEN
    RETURN jsonb_build_object('success', true, 'points_awarded', false, 'message', '评价已审核通过');
  END IF;
  IF rev.status NOT IN ('pending', 'rejected') OR rev.status IS NULL THEN
    RAISE EXCEPTION '无效的评价状态';
  END IF;
  UPDATE public.reviews
  SET status = 'approved', reject_reason = NULL, reviewer_id = v_admin.id,
      reviewed_at = now(), is_public = true
  WHERE id = p_review_id;

  IF NOT coalesce(rev.is_historical_migrated, false)
     AND EXISTS (SELECT 1 FROM auth.users WHERE id::text = rev.user_id) THEN
    PERFORM private.upc_ensure_profile(rev.user_id);
    PERFORM 1 FROM public.user_profiles WHERE id = rev.user_id FOR UPDATE;
    v_business_key := rev.user_id || '|' || rev.teacher_id || '|' || rev.course_id::text || '|' || rev.term_id::text;
    SELECT EXISTS (
      SELECT 1 FROM private.upc_review_rewards
      WHERE user_id = rev.user_id AND status = 'needs_verification'
    ) INTO v_needs_verification;
    INSERT INTO private.upc_review_rewards
      (review_id, user_id, teacher_id, course_id, term_id, business_key, status)
    VALUES (rev.id, rev.user_id, rev.teacher_id, rev.course_id, rev.term_id, v_business_key,
      CASE WHEN v_needs_verification THEN 'needs_verification' ELSE 'awarded' END)
    ON CONFLICT DO NOTHING
    RETURNING review_id INTO inserted_key;
    IF inserted_key IS NOT NULL AND NOT v_needs_verification THEN
      SELECT pr.points_delta INTO reward
      FROM public.point_rules pr
      WHERE pr.action_code = 'review_approved' AND pr.is_active;
      IF reward IS NULL OR reward <= 0 THEN RAISE EXCEPTION '评价奖励规则不可用'; END IF;
      UPDATE public.user_profiles p
      SET points = p.points + reward
      WHERE id = rev.user_id
      RETURNING p.points INTO bal;
      INSERT INTO public.point_transactions
        (id, user_id, action, action_code, amount, balance_after, related_review_id)
      VALUES (gen_random_uuid()::text, rev.user_id, '撰写教师评价审核通过',
        'review_approved', reward, bal, rev.id);
    ELSIF inserted_key IS NOT NULL AND v_needs_verification THEN
      INSERT INTO private.upc_admin_audit_log
        (actor_user_id, actor_admin_id, action, target_type, target_id, reason)
      VALUES (auth.uid(), v_admin.id, 'review_reward_needs_verification',
        'review', rev.id, '存在无法还原的历史奖励关联，本次不自动发奖');
    END IF;
  END IF;

  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), v_admin.id, 'review_approve', 'review', rev.id,
    jsonb_build_object('points_awarded', inserted_key IS NOT NULL AND NOT v_needs_verification));

  RETURN jsonb_build_object('success', true,
    'points_awarded', inserted_key IS NOT NULL AND NOT v_needs_verification,
    'message', CASE WHEN inserted_key IS NOT NULL AND v_needs_verification
      THEN '评价已通过；历史奖励待核验，本次未自动发奖'
      ELSE '评价已通过审核' END);
END $$;

DROP FUNCTION IF EXISTS public.reject_review(TEXT, TEXT);
CREATE FUNCTION public.reject_review(p_review_id TEXT, p_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users;
BEGIN
  v_admin := private.upc_require_admin();
  IF nullif(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION '请填写驳回原因'; END IF;
  UPDATE public.reviews
  SET status = 'rejected', reject_reason = p_reason, reviewer_id = v_admin.id,
      reviewed_at = now()
  WHERE id = p_review_id;
  IF FOUND THEN
    INSERT INTO private.upc_admin_audit_log
      (actor_user_id, actor_admin_id, action, target_type, target_id, reason)
    VALUES (auth.uid(), v_admin.id, 'review_reject', 'review', p_review_id, p_reason);
  END IF;
  RETURN jsonb_build_object('success', FOUND, 'message',
    CASE WHEN FOUND THEN '评价已被驳回' ELSE '评价不存在' END);
END $$;

CREATE OR REPLACE FUNCTION public.delete_review_as_admin(p_review_id TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users; v_deleted INTEGER;
BEGIN
  v_admin := private.upc_require_admin();
  IF nullif(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION '请填写删除原因'; END IF;
  DELETE FROM public.reviews WHERE id = p_review_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 1 THEN
    INSERT INTO private.upc_admin_audit_log
      (actor_user_id, actor_admin_id, action, target_type, target_id, reason)
    VALUES (auth.uid(), v_admin.id, 'review_delete', 'review', p_review_id, p_reason);
  END IF;
  RETURN jsonb_build_object('success', v_deleted = 1);
END $$;
REVOKE ALL ON FUNCTION public.delete_review_as_admin(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_review_as_admin(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_review_counts() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN (private.upc_admin_record()).id IS NULL OR NOT private.upc_has_aal2() THEN
    jsonb_build_object('pending', 0, 'approved', 0, 'rejected', 0, 'withdrawn', 0)
  ELSE (
    SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'withdrawn', count(*) FILTER (WHERE status = 'withdrawn')
    ) FROM public.reviews
  ) END
$$;
REVOKE ALL ON FUNCTION public.get_admin_review_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_review_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_audit_log(p_limit INTEGER DEFAULT 100)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(l)
  FROM (
    SELECT id, action, target_type, target_id, reason, metadata, created_at
    FROM private.upc_admin_audit_log
    WHERE private.upc_admin_role() IN ('super_admin', 'admin') AND private.upc_has_aal2()
    ORDER BY created_at DESC, id DESC
    LIMIT greatest(1, least(coalesce(p_limit, 100), 200))
  ) l
$$;
REVOKE ALL ON FUNCTION public.get_admin_audit_log(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(INTEGER) TO authenticated;

-- Sensitive identity lookup is a separate capability with a mandatory purpose
-- and a permanent audit row. It is not available to ordinary moderators.
CREATE OR REPLACE FUNCTION public.admin_lookup_review_identity(p_review_id TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users; v_user auth.users%ROWTYPE;
BEGIN
  v_admin := private.upc_require_admin();
  IF NOT (v_admin.role = 'super_admin' OR v_admin.can_investigate_identity) THEN
    RAISE EXCEPTION '无敏感身份调查权限';
  END IF;
  IF char_length(coalesce(trim(p_reason), '')) < 10 THEN
    RAISE EXCEPTION '敏感身份调查必须填写至少 10 个字的用途';
  END IF;
  SELECT u.* INTO v_user
  FROM public.reviews r JOIN auth.users u ON u.id::text = r.user_id
  WHERE r.id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION '评价或关联账户不存在'; END IF;
  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), v_admin.id, 'identity_lookup', 'review', p_review_id, p_reason);
  RETURN jsonb_build_object('user_id', v_user.id, 'email', v_user.email,
    'email_confirmed_at', v_user.email_confirmed_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_lookup_review_identity(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_review_identity(TEXT, TEXT) TO authenticated;

-- Manage administrators by stable auth subject. The browser can only call the
-- RPC; base admin_users writes are not granted.
CREATE OR REPLACE FUNCTION public.set_admin_role(
  p_user_id UUID, p_role TEXT, p_nickname TEXT DEFAULT NULL,
  p_can_investigate_identity BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users; v_email TEXT;
BEGIN
  v_admin := private.upc_require_admin();
  IF v_admin.role <> 'super_admin' THEN RAISE EXCEPTION '仅超级管理员可管理管理员'; END IF;
  IF p_role NOT IN ('super_admin', 'admin', 'moderator') THEN RAISE EXCEPTION '无效角色'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION '目标账号不存在或未验证'; END IF;
  IF NOT private.upc_is_admin_email(v_email) THEN
    RAISE EXCEPTION '管理员仅允许由运营者指定的 @gmail.com 邮箱';
  END IF;
  INSERT INTO public.admin_users (user_id, email, role, nickname, is_active, can_investigate_identity)
  VALUES (p_user_id, v_email, p_role, coalesce(nullif(trim(p_nickname), ''), '反馈审核员'), true,
    coalesce(p_can_investigate_identity, false))
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE
  SET role = EXCLUDED.role, nickname = EXCLUDED.nickname,
      can_investigate_identity = EXCLUDED.can_investigate_identity, is_active = true;
  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), v_admin.id, 'admin_role_set', 'admin_user', p_user_id::text,
    jsonb_build_object('role', p_role, 'can_investigate_identity', p_can_investigate_identity));
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE ALL ON FUNCTION public.set_admin_role(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_role(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_admin_active(p_user_id UUID, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users; v_updated INTEGER;
BEGIN
  v_admin := private.upc_require_admin();
  IF v_admin.role <> 'super_admin' THEN RAISE EXCEPTION '仅超级管理员可管理管理员'; END IF;
  UPDATE public.admin_users SET is_active = p_active WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    INSERT INTO private.upc_admin_audit_log
      (actor_user_id, actor_admin_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), v_admin.id, 'admin_active_set', 'admin_user', p_user_id::text,
      jsonb_build_object('active', p_active));
  END IF;
  RETURN jsonb_build_object('success', v_updated = 1);
END $$;
REVOKE ALL ON FUNCTION public.set_admin_active(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_active(UUID, BOOLEAN) TO authenticated;

-- Gmail administrators are manually provisioned through a private, expiring invite.
-- The first super_admin is bootstrapped by controlled SQL/service access; this
-- RPC cannot be called by the public and does not relax student review checks.
CREATE OR REPLACE FUNCTION public.create_admin_invite(p_email TEXT, p_hours INTEGER DEFAULT 24)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin public.admin_users; v_email TEXT := lower(btrim(p_email));
BEGIN
  v_admin := private.upc_require_admin();
  IF v_admin.role <> 'super_admin' THEN RAISE EXCEPTION '仅超级管理员可创建管理员邀请'; END IF;
  IF NOT private.upc_is_admin_email(v_email) THEN
    RAISE EXCEPTION '管理员邀请仅允许由运营者指定的 @gmail.com 邮箱';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION '邀请有效期须在 1–168 小时';
  END IF;
  INSERT INTO private.upc_admin_invites (email, expires_at, used_at, created_by)
  VALUES (v_email, now() + make_interval(hours => p_hours), NULL, v_admin.id)
  ON CONFLICT (email) DO UPDATE
  SET expires_at = EXCLUDED.expires_at, used_at = NULL, created_by = EXCLUDED.created_by,
      created_at = now();
  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), v_admin.id, 'admin_invite_create', 'admin_invite', v_email,
    jsonb_build_object('hours', p_hours));
  RETURN jsonb_build_object('success', true, 'expires_at', now() + make_interval(hours => p_hours));
END $$;
REVOKE ALL ON FUNCTION public.create_admin_invite(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admin_invite(TEXT, INTEGER) TO authenticated;

-- Revoke default PUBLIC execution, including any historical overloads.
DO $$
DECLARE v RECORD;
BEGIN
  FOR v IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_my_admin_status','handle_daily_checkin','spend_points','approve_review',
        'reject_review','delete_review_as_admin','get_admin_review_counts','get_admin_audit_log',
        'admin_lookup_review_identity','set_admin_role','set_admin_active','create_admin_invite')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_my_admin_status(), public.handle_daily_checkin(),
  public.spend_points(TEXT, TEXT), public.approve_review(TEXT), public.reject_review(TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_review_as_admin(TEXT, TEXT),
  public.get_admin_review_counts(), public.get_admin_audit_log(INTEGER),
  public.admin_lookup_review_identity(TEXT, TEXT), public.set_admin_role(UUID, TEXT, TEXT, BOOLEAN),
  public.set_admin_active(UUID, BOOLEAN), public.create_admin_invite(TEXT, INTEGER) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
