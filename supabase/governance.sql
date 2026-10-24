-- UPC governance queue and controlled processing RPCs.
-- Users submit and see only their own requests. Applicant text is never public.
-- Administrators read a controlled projection and process through audited RPCs.

GRANT SELECT ON public.governance_requests TO authenticated;
DROP POLICY IF EXISTS governance_requester_read ON public.governance_requests;
CREATE POLICY governance_requester_read ON public.governance_requests FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid());

-- BEGIN governance-queue-view
DROP VIEW IF EXISTS public.admin_governance_queue;
CREATE VIEW public.admin_governance_queue AS
SELECT
  g.id, g.request_type, g.requester_kind, g.source,
  g.target_teacher_id, t.name AS target_teacher_name,
  t.title AS target_teacher_title,
  tc.code AS target_teacher_college_code,
  t.campus AS target_teacher_campus,
  g.target_review_id, g.target_course_id, c.name AS target_course_name,
  c.code AS target_course_code,
  cc.code AS target_course_college_code,
  g.target_offering_id,
  o.teacher_id AS target_offering_teacher_id,
  o.course_id AS target_offering_course_id,
  o.term_id AS target_offering_term_id,
  o.source_id AS target_offering_source_id,
  g.statement, g.evidence_summary,
  g.status, g.resolution, g.assigned_admin_id, g.external_case_ref,
  g.created_at, g.updated_at, g.resolved_at
FROM public.governance_requests g
LEFT JOIN public.teachers t ON t.id = g.target_teacher_id
LEFT JOIN public.colleges tc ON tc.id = t.college_id
LEFT JOIN public.courses c ON c.id = g.target_course_id
LEFT JOIN public.colleges cc ON cc.id = c.college_id
LEFT JOIN public.course_offerings o ON o.id = g.target_offering_id and g.target_offering_id is not null
WHERE (private.upc_admin_record()).id IS NOT NULL AND private.upc_has_aal2();
REVOKE ALL ON public.admin_governance_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_governance_queue TO authenticated;
-- END governance-queue-view

CREATE OR REPLACE FUNCTION public.submit_governance_request(
  p_type TEXT,
  p_statement TEXT,
  p_target_teacher_id TEXT DEFAULT NULL,
  p_target_review_id TEXT DEFAULT NULL,
  p_target_course_id UUID DEFAULT NULL,
  p_target_offering_id UUID DEFAULT NULL,
  p_evidence_summary TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid UUID := auth.uid();
  v_type TEXT := nullif(trim(p_type), '');
  v_statement TEXT := nullif(trim(p_statement), '');
  v_teacher TEXT := p_target_teacher_id;
  v_course UUID := p_target_course_id;
  v_term UUID;
  v_daily_limit INTEGER := 5;
  v_today_count INTEGER;
  v_id UUID;
  v_offering public.course_offerings%ROWTYPE;
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '请先登录后提交申请';
  END IF;
  IF v_type NOT IN ('teacher_profile_correction', 'course_offering_correction',
    'review_report', 'review_withdrawal', 'account_deletion') THEN
    RAISE EXCEPTION '无效的申请类型';
  END IF;
  IF v_statement IS NULL OR char_length(v_statement) < 10 OR char_length(v_statement) > 2000 THEN
    RAISE EXCEPTION '申请说明须为 10 至 2000 个字符';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text, 20261024));
  SELECT coalesce((value #>> '{}')::int, 5) INTO v_daily_limit
  FROM private.upc_security_settings WHERE key = 'governance_daily_limit';
  SELECT count(*) INTO v_today_count
  FROM public.governance_requests
  WHERE requester_user_id = uid
    AND created_at >= clock_timestamp() - interval '24 hours'
    AND status <> 'withdrawn';
  IF v_today_count >= v_daily_limit THEN
    RAISE EXCEPTION '24 小时内申请次数已达上限';
  END IF;

  IF v_type = 'teacher_profile_correction' THEN
    IF v_teacher IS NULL OR NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = v_teacher) THEN
      RAISE EXCEPTION '教师资料纠错目标不存在';
    END IF;
  ELSIF v_type = 'course_offering_correction' THEN
    IF p_target_offering_id IS NOT NULL THEN
      SELECT * INTO v_offering FROM public.course_offerings WHERE id = p_target_offering_id;
      IF NOT FOUND THEN RAISE EXCEPTION '授课关系目标不存在'; END IF;
      v_teacher := v_offering.teacher_id;
      v_course := v_offering.course_id;
      v_term := v_offering.term_id;
    ELSIF v_teacher IS NULL AND v_course IS NULL THEN
      RAISE EXCEPTION '课程或授课关系纠错至少需要指定一个目标';
    ELSIF v_teacher IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = v_teacher) THEN
      RAISE EXCEPTION '教师目标不存在';
    ELSIF v_course IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.courses WHERE id = v_course) THEN
      RAISE EXCEPTION '课程目标不存在';
    END IF;
  ELSIF v_type = 'review_report' THEN
    IF p_target_review_id IS NULL THEN RAISE EXCEPTION '举报必须指定评价'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.reviews
      WHERE id = p_target_review_id AND status = 'approved' AND is_public
    ) THEN
      RAISE EXCEPTION '只能举报已公开的评价';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.reviews WHERE id = p_target_review_id AND user_id = uid::text
    ) THEN
      RAISE EXCEPTION '不能举报本人评价；如需撤回请使用撤回申请';
    END IF;
  ELSIF v_type = 'review_withdrawal' THEN
    IF p_target_review_id IS NULL THEN RAISE EXCEPTION '撤回申请必须指定评价'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.reviews
      WHERE id = p_target_review_id AND user_id = uid::text AND status = 'approved'
    ) THEN
      RAISE EXCEPTION '只能撤回本人已公开的评价';
    END IF;
  END IF;

  INSERT INTO public.governance_requests (
    request_type, requester_user_id, requester_kind, source,
    target_teacher_id, target_review_id, target_course_id, target_offering_id,
    statement, evidence_summary, status
  ) VALUES (
    v_type, uid, 'student', 'user',
    v_teacher, p_target_review_id, v_course, p_target_offering_id,
    v_statement, nullif(trim(p_evidence_summary), ''), 'submitted'
  ) RETURNING id INTO v_id;

  INSERT INTO private.upc_governance_events
    (request_id, actor_user_id, action, to_status, note)
  VALUES (v_id, uid, 'submitted', 'submitted', NULL);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'status', 'submitted');
END $$;
REVOKE ALL ON FUNCTION public.submit_governance_request(TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_governance_request(TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_governance_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid UUID := auth.uid(); v_status TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
  SELECT status INTO v_status
  FROM public.governance_requests
  WHERE id = p_request_id AND requester_user_id = uid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_status NOT IN ('submitted', 'triaged', 'in_review') THEN
    RAISE EXCEPTION '当前状态不能撤回申请';
  END IF;
  UPDATE public.governance_requests
  SET status = 'withdrawn', updated_at = now()
  WHERE id = p_request_id AND requester_user_id = uid;
  INSERT INTO private.upc_governance_events
    (request_id, actor_user_id, action, from_status, to_status)
  VALUES (p_request_id, uid, 'withdrawn_by_requester', v_status, 'withdrawn');
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_governance_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_governance_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_governance_request(
  p_request_id UUID, p_status TEXT, p_resolution TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin public.admin_users;
  v_req public.governance_requests%ROWTYPE;
  v_status TEXT := nullif(trim(p_status), '');
  v_resolution TEXT := nullif(trim(p_resolution), '');
BEGIN
  v_admin := private.upc_require_admin();
  IF v_admin.role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION '仅审核管理员可处理治理申请';
  END IF;
  IF v_status NOT IN ('triaged', 'in_review', 'accepted', 'rejected', 'completed') THEN
    RAISE EXCEPTION '无效的处理状态';
  END IF;
  IF v_status IN ('accepted', 'rejected', 'completed')
     AND (v_resolution IS NULL OR char_length(v_resolution) < 2) THEN
    RAISE EXCEPTION '接受、驳回或完成时必须填写处理结论';
  END IF;

  SELECT * INTO v_req FROM public.governance_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_status IN ('accepted', 'completed')
     AND v_req.request_type IN ('teacher_profile_correction', 'course_offering_correction') THEN
    RAISE EXCEPTION '资料纠错必须通过 apply_governance_correction 实际写回，不能仅修改申请状态';
  END IF;
  IF v_req.status IN ('withdrawn', 'completed', 'rejected') THEN
    RAISE EXCEPTION '申请已结束，不能重复处理';
  END IF;
  IF NOT (
    (v_req.status = 'submitted' AND v_status IN ('triaged', 'in_review', 'accepted', 'rejected'))
    OR (v_req.status = 'triaged' AND v_status IN ('in_review', 'accepted', 'rejected'))
    OR (v_req.status = 'in_review' AND v_status IN ('accepted', 'rejected', 'completed'))
    OR (v_req.status = 'accepted' AND v_status = 'completed')
  ) THEN
    RAISE EXCEPTION '不允许的状态流转：% -> %', v_req.status, v_status;
  END IF;

  IF v_status IN ('accepted', 'completed') AND v_req.request_type = 'review_withdrawal' THEN
    UPDATE public.reviews
    SET is_public = false, status = 'withdrawn', withdrawn_at = now()
    WHERE id = v_req.target_review_id AND user_id = v_req.requester_user_id::text
      AND status = 'approved';
  ELSIF v_status IN ('accepted', 'completed') AND v_req.request_type = 'review_report' THEN
    UPDATE public.reviews
    SET is_public = false
    WHERE id = v_req.target_review_id AND status = 'approved';
  END IF;

  UPDATE public.governance_requests
  SET status = v_status,
      resolution = coalesce(v_resolution, resolution),
      assigned_admin_id = v_admin.id,
      updated_at = now(),
      resolved_at = CASE WHEN v_status IN ('accepted', 'rejected', 'completed') THEN now() ELSE resolved_at END
  WHERE id = p_request_id;

  INSERT INTO private.upc_governance_events
    (request_id, actor_user_id, actor_admin_id, action, from_status, to_status, note)
  VALUES (p_request_id, auth.uid(), v_admin.id, 'status_change', v_req.status, v_status, v_resolution);
  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), v_admin.id, 'governance_process', 'governance_request', p_request_id::text,
    v_resolution, jsonb_build_object('from', v_req.status, 'to', v_status, 'type', v_req.request_type));

  RETURN jsonb_build_object('success', true, 'status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.process_governance_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_governance_request(UUID, TEXT, TEXT) TO authenticated;

-- BEGIN correction-apply-rpc
-- Accepted teacher/course/offering corrections are written back here. A status
-- change alone is never treated as completion: this RPC validates the patch,
-- applies it atomically, records the before/after diff and source basis, links
-- the correction to the request and pins protected fields against re-import.
CREATE OR REPLACE FUNCTION public.apply_governance_correction(
  p_request_id UUID,
  p_patch JSONB,
  p_source_basis TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin public.admin_users;
  v_req public.governance_requests%ROWTYPE;
  v_basis TEXT := nullif(btrim(p_source_basis), '');
  v_patch JSONB := p_patch;
  v_obj JSONB;
  v_teacher public.teachers%ROWTYPE;
  v_course public.courses%ROWTYPE;
  v_offering public.course_offerings%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
  v_target_type TEXT;
  v_target_id TEXT;
  v_action TEXT := 'update';
  v_name TEXT;
  v_title TEXT;
  v_campus TEXT;
  v_college_code TEXT;
  v_college_id UUID;
  v_course_name TEXT;
  v_course_code TEXT;
  v_course_college_id UUID;
  v_teacher_id TEXT;
  v_course_id UUID;
  v_term_id UUID;
  v_source_id TEXT;
  v_offering_id UUID;
  v_reviews INTEGER;
  v_stats INTEGER;
  v_changed TEXT[];
  v_correction_id BIGINT;
  v_pin_key TEXT;
BEGIN
  v_admin := private.upc_require_admin();
  IF v_admin.role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION '仅审核管理员可写回资料纠正';
  END IF;
  IF NOT private.upc_has_aal2() THEN
    RAISE EXCEPTION '资料纠正写回需要 AAL2 强验证，请先完成 MFA';
  END IF;
  IF v_patch IS NULL OR jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION '纠正内容必须是 JSON 对象';
  END IF;
  IF v_basis IS NULL OR char_length(v_basis) < 10 OR char_length(v_basis) > 2000 THEN
    RAISE EXCEPTION '来源依据须为 10 至 2000 个字符';
  END IF;

  SELECT * INTO v_req FROM public.governance_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_req.request_type NOT IN ('teacher_profile_correction', 'course_offering_correction') THEN
    RAISE EXCEPTION '该申请不是资料纠错类型';
  END IF;
  IF EXISTS (SELECT 1 FROM private.upc_data_corrections WHERE request_id = p_request_id) THEN
    RAISE EXCEPTION '该申请已写回，不能重复处理';
  END IF;
  IF v_req.status NOT IN ('submitted', 'triaged', 'in_review', 'accepted') THEN
    RAISE EXCEPTION '申请当前状态不能写回：%', v_req.status;
  END IF;
  IF v_req.request_type = 'teacher_profile_correction' THEN
    IF NOT (v_patch ? 'teacher') OR jsonb_typeof(v_patch->'teacher') <> 'object' THEN
      RAISE EXCEPTION '教师资料纠正须提供 teacher 对象';
    END IF;
    IF (v_patch - 'teacher') <> '{}'::jsonb THEN
      RAISE EXCEPTION '存在未支持的纠正字段';
    END IF;
    v_obj := v_patch->'teacher';
    IF (v_obj - ARRAY['id', 'name', 'title', 'collegeCode', 'campus']) <> '{}'::jsonb THEN
      RAISE EXCEPTION '教师纠正包含不允许的字段';
    END IF;
    IF v_req.target_teacher_id IS NULL THEN
      RAISE EXCEPTION '申请未指定教师目标';
    END IF;
    SELECT * INTO v_teacher FROM public.teachers
    WHERE id = v_req.target_teacher_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '教师目标不存在'; END IF;
    IF v_obj ? 'id' AND nullif(btrim(v_obj->>'id'), '') IS DISTINCT FROM v_teacher.id THEN
      RAISE EXCEPTION '不能改变申请指向的教师';
    END IF;

    v_before := jsonb_build_object(
      'name', v_teacher.name, 'title', v_teacher.title,
      'college_id', v_teacher.college_id, 'campus', v_teacher.campus
    );
    v_name := CASE WHEN v_obj ? 'name'
      THEN nullif(btrim(v_obj->>'name'), '') ELSE v_teacher.name END;
    v_title := CASE WHEN v_obj ? 'title'
      THEN nullif(btrim(v_obj->>'title'), '') ELSE v_teacher.title END;
    v_campus := CASE WHEN v_obj ? 'campus'
      THEN nullif(btrim(v_obj->>'campus'), '') ELSE v_teacher.campus END;
    IF v_obj ? 'collegeCode' THEN
      v_college_code := nullif(btrim(v_obj->>'collegeCode'), '');
      IF v_college_code IS NULL THEN RAISE EXCEPTION '学院编码不能为空'; END IF;
      SELECT id INTO v_college_id FROM public.colleges WHERE code = v_college_code;
      IF v_college_id IS NULL THEN RAISE EXCEPTION '学院编码不存在'; END IF;
    ELSE
      v_college_id := v_teacher.college_id;
    END IF;
    IF v_name IS NULL OR char_length(v_name) > 80 THEN
      RAISE EXCEPTION '教师姓名须为 1 至 80 个字符';
    END IF;
    IF v_title IS NOT NULL AND char_length(v_title) > 40 THEN
      RAISE EXCEPTION '职称不能超过 40 个字符';
    END IF;
    IF v_campus IS NOT NULL AND v_campus NOT IN ('唐岛湾校区', '古镇口校区', '东营科教园区') THEN
      RAISE EXCEPTION '校区不在 UPC 枚举中';
    END IF;

    v_after := jsonb_build_object(
      'name', v_name, 'title', v_title,
      'college_id', v_college_id, 'campus', v_campus
    );
    IF v_after = v_before THEN
      RAISE EXCEPTION '未检测到实际变更，不能仅修改申请状态';
    END IF;

    UPDATE public.teachers
    SET name = v_name, title = v_title, college_id = v_college_id,
        campus = v_campus, updated_at = now()
    WHERE id = v_teacher.id;

    v_changed := array_remove(ARRAY[
      CASE WHEN v_after->'name' IS DISTINCT FROM v_before->'name' THEN 'name' END,
      CASE WHEN v_after->'title' IS DISTINCT FROM v_before->'title' THEN 'title' END,
      CASE WHEN v_after->'college_id' IS DISTINCT FROM v_before->'college_id' THEN 'college_id' END,
      CASE WHEN v_after->'campus' IS DISTINCT FROM v_before->'campus' THEN 'campus' END
    ], NULL);
    IF v_after->'name' IS DISTINCT FROM v_before->'name' THEN
      INSERT INTO private.upc_correction_pins AS pin
        (target_table, target_id, field_name, request_id, corrected_value)
      VALUES ('teachers', v_teacher.id, 'name', p_request_id, v_after->'name')
      ON CONFLICT (target_table, target_id, field_name) DO UPDATE
      SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
          applied_at = now();
    END IF;
    IF v_after->'title' IS DISTINCT FROM v_before->'title' THEN
      INSERT INTO private.upc_correction_pins AS pin
        (target_table, target_id, field_name, request_id, corrected_value)
      VALUES ('teachers', v_teacher.id, 'title', p_request_id, v_after->'title')
      ON CONFLICT (target_table, target_id, field_name) DO UPDATE
      SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
          applied_at = now();
    END IF;
    IF v_after->'college_id' IS DISTINCT FROM v_before->'college_id' THEN
      INSERT INTO private.upc_correction_pins AS pin
        (target_table, target_id, field_name, request_id, corrected_value)
      VALUES ('teachers', v_teacher.id, 'college_id', p_request_id, v_after->'college_id')
      ON CONFLICT (target_table, target_id, field_name) DO UPDATE
      SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
          applied_at = now();
    END IF;
    IF v_after->'campus' IS DISTINCT FROM v_before->'campus' THEN
      INSERT INTO private.upc_correction_pins AS pin
        (target_table, target_id, field_name, request_id, corrected_value)
      VALUES ('teachers', v_teacher.id, 'campus', p_request_id, v_after->'campus')
      ON CONFLICT (target_table, target_id, field_name) DO UPDATE
      SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
          applied_at = now();
    END IF;
    v_target_type := 'teacher';
    v_target_id := v_teacher.id;

  ELSIF v_req.request_type = 'course_offering_correction' THEN
    IF (v_patch ? 'course') = (v_patch ? 'offering') THEN
      RAISE EXCEPTION '课程/授课关系纠正须且只能提供 course 或 offering 之一';
    END IF;

    IF v_patch ? 'course' THEN
      IF jsonb_typeof(v_patch->'course') <> 'object' THEN
        RAISE EXCEPTION 'course 必须是对象';
      END IF;
      v_obj := v_patch->'course';
      IF (v_obj - ARRAY['id', 'name', 'code', 'collegeCode']) <> '{}'::jsonb THEN
        RAISE EXCEPTION '课程纠正包含不允许的字段';
      END IF;
      v_course_id := v_req.target_course_id;
      IF v_course_id IS NULL AND v_req.target_offering_id IS NOT NULL THEN
        SELECT course_id INTO v_course_id FROM public.course_offerings
        WHERE id = v_req.target_offering_id;
      END IF;
      IF v_course_id IS NULL THEN RAISE EXCEPTION '申请未指定课程目标'; END IF;
      IF v_obj ? 'id' AND nullif(btrim(v_obj->>'id'), '')::uuid IS DISTINCT FROM v_course_id THEN
        RAISE EXCEPTION '不能改变申请指向的课程';
      END IF;
      SELECT * INTO v_course FROM public.courses WHERE id = v_course_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION '课程目标不存在'; END IF;

      v_before := jsonb_build_object(
        'name', v_course.name, 'code', v_course.code, 'college_id', v_course.college_id
      );
      v_course_name := CASE WHEN v_obj ? 'name'
        THEN nullif(btrim(v_obj->>'name'), '') ELSE v_course.name END;
      v_course_code := CASE WHEN v_obj ? 'code'
        THEN nullif(btrim(v_obj->>'code'), '') ELSE v_course.code END;
      IF v_obj ? 'collegeCode' THEN
        v_college_code := nullif(btrim(v_obj->>'collegeCode'), '');
        IF v_college_code IS NULL THEN RAISE EXCEPTION '课程学院编码不能为空'; END IF;
        SELECT id INTO v_course_college_id FROM public.colleges WHERE code = v_college_code;
        IF v_course_college_id IS NULL THEN RAISE EXCEPTION '课程学院编码不存在'; END IF;
      ELSE
        v_course_college_id := v_course.college_id;
      END IF;
      IF v_course_name IS NULL OR char_length(v_course_name) > 160 THEN
        RAISE EXCEPTION '课程名称须为 1 至 160 个字符';
      END IF;
      IF v_course_code IS NOT NULL AND char_length(v_course_code) > 80 THEN
        RAISE EXCEPTION '课程编码不能超过 80 个字符';
      END IF;
      IF v_course_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.courses WHERE code = v_course_code AND id <> v_course.id
      ) THEN
        RAISE EXCEPTION '课程编码已被其他课程占用';
      END IF;
      IF v_course_code IS NULL AND EXISTS (
        SELECT 1 FROM public.courses
        WHERE name = v_course_name AND college_id = v_course_college_id
          AND code IS NULL AND id <> v_course.id
      ) THEN
        RAISE EXCEPTION '同名无编码课程已存在，不能产生歧义';
      END IF;

      v_after := jsonb_build_object(
        'name', v_course_name, 'code', v_course_code, 'college_id', v_course_college_id
      );
      IF v_after = v_before THEN
        RAISE EXCEPTION '未检测到实际变更，不能仅修改申请状态';
      END IF;

      UPDATE public.courses
      SET name = v_course_name, code = v_course_code, college_id = v_course_college_id
      WHERE id = v_course.id;

      v_changed := array_remove(ARRAY[
        CASE WHEN v_after->'name' IS DISTINCT FROM v_before->'name' THEN 'name' END,
        CASE WHEN v_after->'code' IS DISTINCT FROM v_before->'code' THEN 'code' END,
        CASE WHEN v_after->'college_id' IS DISTINCT FROM v_before->'college_id' THEN 'college_id' END
      ], NULL);
      IF v_after->'name' IS DISTINCT FROM v_before->'name' THEN
        INSERT INTO private.upc_correction_pins AS pin
          (target_table, target_id, field_name, request_id, corrected_value)
        VALUES ('courses', v_course.id::text, 'name', p_request_id, v_after->'name')
        ON CONFLICT (target_table, target_id, field_name) DO UPDATE
        SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
            applied_at = now();
      END IF;
      IF v_after->'code' IS DISTINCT FROM v_before->'code' THEN
        INSERT INTO private.upc_correction_pins AS pin
          (target_table, target_id, field_name, request_id, corrected_value)
        VALUES ('courses', v_course.id::text, 'code', p_request_id, v_after->'code')
        ON CONFLICT (target_table, target_id, field_name) DO UPDATE
        SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
            applied_at = now();
      END IF;
      IF v_after->'college_id' IS DISTINCT FROM v_before->'college_id' THEN
        INSERT INTO private.upc_correction_pins AS pin
          (target_table, target_id, field_name, request_id, corrected_value)
        VALUES ('courses', v_course.id::text, 'college_id', p_request_id, v_after->'college_id')
        ON CONFLICT (target_table, target_id, field_name) DO UPDATE
        SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
            applied_at = now();
      END IF;
      v_target_type := 'course';
      v_target_id := v_course.id::text;

    ELSE
      IF jsonb_typeof(v_patch->'offering') <> 'object' THEN
        RAISE EXCEPTION 'offering 必须是对象';
      END IF;
      v_obj := v_patch->'offering';
      IF (v_obj - ARRAY['action', 'offeringId', 'teacherId', 'courseId', 'termId', 'sourceId'])
         <> '{}'::jsonb THEN
        RAISE EXCEPTION '授课关系纠正包含不允许的字段';
      END IF;
      v_action := lower(coalesce(nullif(btrim(v_obj->>'action'), ''), ''));
      IF v_action NOT IN ('add', 'remove') THEN
        RAISE EXCEPTION '授课关系动作只支持 add 或 remove';
      END IF;

      IF v_action = 'remove' THEN
        v_offering_id := nullif(btrim(v_obj->>'offeringId'), '')::uuid;
        IF v_offering_id IS NULL THEN v_offering_id := v_req.target_offering_id; END IF;
        IF v_offering_id IS NOT NULL THEN
          SELECT * INTO v_offering FROM public.course_offerings
          WHERE id = v_offering_id FOR UPDATE;
        ELSE
          v_teacher_id := nullif(btrim(v_obj->>'teacherId'), '');
          v_course_id := nullif(btrim(v_obj->>'courseId'), '')::uuid;
          v_term_id := nullif(btrim(v_obj->>'termId'), '')::uuid;
          IF v_teacher_id IS NULL OR v_course_id IS NULL OR v_term_id IS NULL THEN
            RAISE EXCEPTION '删除授课关系须提供 offeringId 或完整的 teacherId/courseId/termId';
          END IF;
          SELECT * INTO v_offering FROM public.course_offerings
          WHERE teacher_id = v_teacher_id AND course_id = v_course_id AND term_id = v_term_id
          FOR UPDATE;
        END IF;
        IF NOT FOUND THEN RAISE EXCEPTION '授课关系不存在'; END IF;
        IF v_obj ? 'teacherId'
           AND nullif(btrim(v_obj->>'teacherId'), '') IS DISTINCT FROM v_offering.teacher_id THEN
          RAISE EXCEPTION '提供的教师与授课关系目标不一致';
        END IF;
        IF v_obj ? 'courseId'
           AND nullif(btrim(v_obj->>'courseId'), '')::uuid IS DISTINCT FROM v_offering.course_id THEN
          RAISE EXCEPTION '提供的课程与授课关系目标不一致';
        END IF;
        IF v_obj ? 'termId'
           AND nullif(btrim(v_obj->>'termId'), '')::uuid IS DISTINCT FROM v_offering.term_id THEN
          RAISE EXCEPTION '提供的学期与授课关系目标不一致';
        END IF;

        SELECT count(*)::int INTO v_reviews
        FROM public.reviews
        WHERE teacher_id = v_offering.teacher_id
          AND course_id = v_offering.course_id
          AND term_id = v_offering.term_id;
        SELECT count(*)::int INTO v_stats
        FROM public.offering_rating_stats
        WHERE teacher_id = v_offering.teacher_id
          AND course_id = v_offering.course_id
          AND term_id = v_offering.term_id;
        IF v_reviews > 0 OR v_stats > 0 THEN
          RAISE EXCEPTION '授课关系仍关联 % 条评价和 % 条统计，拒绝自动删除或转移；请先处理评价引用',
            v_reviews, v_stats;
        END IF;

        v_before := to_jsonb(v_offering);
        DELETE FROM public.course_offerings WHERE id = v_offering.id;
        v_after := '{}'::jsonb;
        v_target_type := 'offering';
        v_target_id := v_offering.id::text;
        v_changed := ARRAY['relation'];
        v_pin_key := v_offering.teacher_id || '|' || v_offering.course_id::text
          || '|' || v_offering.term_id::text;
        INSERT INTO private.upc_correction_pins AS pin
          (target_table, target_id, field_name, request_id, corrected_value)
        VALUES ('course_offerings', v_pin_key, 'relation', p_request_id,
          jsonb_build_object('action', 'removed', 'offeringId', v_offering.id))
        ON CONFLICT (target_table, target_id, field_name) DO UPDATE
        SET request_id = EXCLUDED.request_id, corrected_value = EXCLUDED.corrected_value,
            applied_at = now();
      ELSE
        v_teacher_id := nullif(btrim(v_obj->>'teacherId'), '');
        v_course_id := nullif(btrim(v_obj->>'courseId'), '')::uuid;
        v_term_id := nullif(btrim(v_obj->>'termId'), '')::uuid;
        v_source_id := nullif(btrim(v_obj->>'sourceId'), '');
        IF v_obj ? 'offeringId' THEN
          RAISE EXCEPTION '新增授课关系不能指定 offeringId';
        END IF;
        IF v_teacher_id IS NULL OR v_course_id IS NULL OR v_term_id IS NULL THEN
          RAISE EXCEPTION '新增授课关系须提供 teacherId/courseId/termId';
        END IF;
        IF v_source_id IS NOT NULL AND char_length(v_source_id) > 120 THEN
          RAISE EXCEPTION '授课关系来源标识不能超过 120 个字符';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = v_teacher_id) THEN
          RAISE EXCEPTION '教师不存在';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = v_course_id) THEN
          RAISE EXCEPTION '课程不存在';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.terms WHERE id = v_term_id) THEN
          RAISE EXCEPTION '学期不存在';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.course_offerings
          WHERE teacher_id = v_teacher_id AND course_id = v_course_id AND term_id = v_term_id
        ) THEN
          RAISE EXCEPTION '授课关系已存在，无需新增';
        END IF;

        v_before := '{}'::jsonb;
        INSERT INTO public.course_offerings (teacher_id, course_id, term_id, source_id)
        VALUES (v_teacher_id, v_course_id, v_term_id, v_source_id)
        RETURNING * INTO v_offering;
        v_after := to_jsonb(v_offering);
        v_target_type := 'offering';
        v_target_id := v_offering.id::text;
        v_changed := ARRAY['relation'];
        v_pin_key := v_teacher_id || '|' || v_course_id::text || '|' || v_term_id::text;
        DELETE FROM private.upc_correction_pins
        WHERE target_table = 'course_offerings' AND target_id = v_pin_key
          AND field_name = 'relation';
      END IF;
    END IF;
  END IF;

  INSERT INTO private.upc_data_corrections
    (request_id, actor_user_id, actor_admin_id, target_type, target_id, action,
     before_data, after_data, source_basis)
  VALUES (p_request_id, auth.uid(), v_admin.id, v_target_type, v_target_id, v_action,
    v_before, v_after, v_basis)
  RETURNING id INTO v_correction_id;

  UPDATE public.governance_requests
  SET status = 'completed',
      resolution = coalesce(resolution, '资料纠正已写回并完成'),
      assigned_admin_id = v_admin.id,
      updated_at = now(),
      resolved_at = now()
  WHERE id = p_request_id;

  INSERT INTO private.upc_governance_events
    (request_id, actor_user_id, actor_admin_id, action, from_status, to_status, note)
  VALUES (p_request_id, auth.uid(), v_admin.id, 'correction_applied',
    v_req.status, 'completed', v_basis);

  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), v_admin.id, 'governance_correction_apply', v_target_type,
    v_target_id, v_basis, jsonb_build_object(
      'request_id', p_request_id,
      'correction_id', v_correction_id,
      'action', v_action,
      'changed_fields', to_jsonb(v_changed)
    ));

  RETURN jsonb_build_object(
    'success', true, 'correction_id', v_correction_id, 'request_id', p_request_id,
    'status', 'completed', 'target_type', v_target_type, 'target_id', v_target_id,
    'action', v_action, 'changed_fields', to_jsonb(v_changed),
    'before', v_before, 'after', v_after
  );
END $$;
REVOKE ALL ON FUNCTION public.apply_governance_correction(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_governance_correction(UUID, JSONB, TEXT) TO authenticated;
-- END correction-apply-rpc

-- BEGIN admin-mfa-recovery
-- Controlled recovery after an administrator loses a TOTP device. This is not a
-- public recovery endpoint: only the service role may execute it, and it never
-- changes the administrator's role, active flag or password. The operator must
-- verify identity out of band, delete the old factors through the Auth Admin API,
-- then call this function to revoke sessions and append an audit record.
CREATE OR REPLACE FUNCTION public.record_admin_mfa_recovery(
  p_user_id UUID,
  p_operator TEXT,
  p_reason TEXT,
  p_factor_ids TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin public.admin_users%ROWTYPE;
  v_sessions INTEGER;
  v_operator TEXT := nullif(btrim(p_operator), '');
  v_reason TEXT := nullif(btrim(p_reason), '');
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
     <> 'service_role' THEN
    RAISE EXCEPTION '仅受控后台服务可执行管理员 MFA 恢复';
  END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION '目标管理员 user_id 必填'; END IF;
  IF v_operator IS NULL OR char_length(v_operator) < 2 OR char_length(v_operator) > 120 THEN
    RAISE EXCEPTION '操作人标识须为 2 至 120 个字符';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 20 OR char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION '恢复原因须为 20 至 1000 个字符';
  END IF;
  IF p_factor_ids IS NULL OR cardinality(p_factor_ids) = 0
     OR cardinality(p_factor_ids) > 20 THEN
    RAISE EXCEPTION '须提供 1 至 20 个已删除的 MFA factor 标识';
  END IF;

  SELECT * INTO v_admin FROM public.admin_users WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '目标不是已登记管理员'; END IF;

  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  INSERT INTO private.upc_admin_audit_log
    (actor_user_id, actor_admin_id, action, target_type, target_id, reason, metadata)
  VALUES (NULL, NULL, 'admin_mfa_recovery', 'admin_user', p_user_id::text, v_reason,
    jsonb_build_object(
      'operator', v_operator,
      'factor_ids', to_jsonb(p_factor_ids),
      'sessions_revoked', v_sessions,
      'admin_role', v_admin.role,
      'admin_active', v_admin.is_active
    ));

  RETURN jsonb_build_object(
    'success', true, 'sessions_revoked', v_sessions,
    'role', v_admin.role, 'active', v_admin.is_active
  );
END $$;
REVOKE ALL ON FUNCTION public.record_admin_mfa_recovery(UUID, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_admin_mfa_recovery(UUID, TEXT, TEXT, TEXT[])
      TO service_role;
  END IF;
END $$;
-- END admin-mfa-recovery


-- BEGIN removed-teacher-appeal-policy
-- Retire the creation RPC without deleting historical requests or audit rows.
DROP FUNCTION IF EXISTS public.create_proxy_teacher_appeal(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION private.upc_guard_governance_request_type() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.request_type NOT IN ('teacher_profile_correction', 'course_offering_correction',
      'review_report', 'review_withdrawal', 'account_deletion') THEN
    RAISE EXCEPTION '不支持的申请类型';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.upc_guard_governance_request_type() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS governance_request_type_guard ON public.governance_requests;
CREATE TRIGGER governance_request_type_guard
  BEFORE INSERT OR UPDATE OF request_type ON public.governance_requests
  FOR EACH ROW EXECUTE FUNCTION private.upc_guard_governance_request_type();
-- END removed-teacher-appeal-policy

CREATE OR REPLACE FUNCTION public.get_admin_governance_counts() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN (private.upc_admin_record()).id IS NULL OR NOT private.upc_has_aal2() THEN '{}'::jsonb ELSE (
    SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*)::int AS n FROM public.governance_requests GROUP BY status
    ) s
  ) END
$$;
REVOKE ALL ON FUNCTION public.get_admin_governance_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_governance_counts() TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
