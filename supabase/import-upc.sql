-- Atomic UPC data import. Executed with the service role only.
--
-- Contract:
--   * teachers are keyed by sourceId and stored as 'upc:<sourceId>';
--   * same-name teachers are never merged;
--   * courses are keyed by code when present, otherwise by (name, college);
--   * offerings require a term and are unique by teacher × course × term;
--   * a dry run executes the same writes in a subtransaction, then rolls back;
--     batch conflicts therefore fail the preflight exactly as the real import;
--   * any bad row aborts the whole call, so a partial batch is never committed.

CREATE OR REPLACE FUNCTION private.upc_import_dataset_apply(
  p_payload JSONB,
  p_checksum TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_term JSONB;
  v_teachers JSONB;
  v_teacher JSONB;
  v_course JSONB;
  v_dataset TEXT;
  v_source TEXT;
  v_term_code TEXT;
  v_term_name TEXT;
  v_term_current BOOLEAN;
  v_term_id UUID;
  v_existing_term_name TEXT;
  v_existing_term_current BOOLEAN;
  v_term_inserted INT := 0;
  v_term_updated INT := 0;
  v_term_skipped INT := 0;
  v_teacher_inserted INT := 0;
  v_teacher_updated INT := 0;
  v_teacher_skipped INT := 0;
  v_teacher_protected INT := 0;
  v_course_inserted INT := 0;
  v_course_updated INT := 0;
  v_course_skipped INT := 0;
  v_course_protected INT := 0;
  v_offering_inserted INT := 0;
  v_offering_skipped INT := 0;
  v_offering_protected INT := 0;
  v_source_id TEXT;
  v_teacher_id TEXT;
  v_name TEXT;
  v_title TEXT;
  v_campus TEXT;
  v_college_code TEXT;
  v_college_id UUID;
  v_current_name TEXT;
  v_current_title TEXT;
  v_current_campus TEXT;
  v_current_college_id UUID;
  v_pin_name BOOLEAN;
  v_pin_title BOOLEAN;
  v_pin_campus BOOLEAN;
  v_pin_college BOOLEAN;
  v_pin_course_name BOOLEAN;
  v_pin_course_code BOOLEAN;
  v_pin_course_college BOOLEAN;
  v_pinned_code_course_id UUID;
  v_course_code TEXT;
  v_course_name TEXT;
  v_course_college_code TEXT;
  v_course_college_id UUID;
  v_course_id UUID;
  v_existing_course_name TEXT;
  v_existing_course_college UUID;
  v_same BOOLEAN;
  v_rows INT;
  v_summary JSONB;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION '导入数据必须是 JSON 对象';
  END IF;
  IF coalesce(p_payload->>'schemaVersion', '') !~ '^[0-9]+$'
     OR (p_payload->>'schemaVersion')::int <> 1 THEN
    RAISE EXCEPTION '不支持的导入数据版本，只接受 schemaVersion=1';
  END IF;
  IF p_checksum IS NULL OR p_checksum !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION '缺少有效的 SHA-256 校验值';
  END IF;

  v_dataset := nullif(trim(p_payload->>'dataset'), '');
  v_source := nullif(trim(p_payload->>'source'), '');
  IF v_dataset IS NULL OR char_length(v_dataset) > 200 THEN
    RAISE EXCEPTION 'dataset 必填且不超过 200 字符';
  END IF;
  IF v_source IS NULL OR char_length(v_source) > 500 THEN
    RAISE EXCEPTION 'source 必填且不超过 500 字符（记录可核对的来源）';
  END IF;

  v_teachers := p_payload->'teachers';
  IF v_teachers IS NULL OR jsonb_typeof(v_teachers) <> 'array' OR jsonb_array_length(v_teachers) = 0 THEN
    RAISE EXCEPTION 'teachers 必须是非空数组';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_teachers) e
    GROUP BY nullif(trim(e->>'sourceId'), '')
    HAVING count(*) > 1 OR nullif(trim(e->>'sourceId'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'teachers 中存在空白或重复的 sourceId';
  END IF;

  v_term := p_payload->'term';
  IF v_term IS NOT NULL AND jsonb_typeof(v_term) = 'null' THEN
    v_term := NULL;
  END IF;
  IF v_term IS NOT NULL THEN
    IF jsonb_typeof(v_term) <> 'object' THEN
      RAISE EXCEPTION 'term 必须是对象或 null';
    END IF;
    v_term_code := nullif(trim(v_term->>'code'), '');
    v_term_name := nullif(trim(v_term->>'name'), '');
    IF v_term_code IS NULL OR v_term_name IS NULL THEN
      RAISE EXCEPTION 'term.code 与 term.name 均必填';
    END IF;
    v_term_current := coalesce((v_term->>'isCurrent')::boolean, false);

    SELECT id, year_term, is_current INTO v_term_id, v_existing_term_name, v_existing_term_current
    FROM public.terms WHERE code = v_term_code;

    IF v_term_id IS NULL THEN
      INSERT INTO public.terms (code, year_term, is_current)
      VALUES (v_term_code, v_term_name, false)
      RETURNING id INTO v_term_id;
      v_term_inserted := v_term_inserted + 1;
    ELSIF v_existing_term_name = v_term_name AND v_existing_term_current = v_term_current THEN
      v_term_skipped := v_term_skipped + 1;
    ELSE
      UPDATE public.terms
      SET year_term = v_term_name
      WHERE id = v_term_id;
      v_term_updated := v_term_updated + 1;
    END IF;

    IF v_term_current THEN
      UPDATE public.terms SET is_current = false
      WHERE is_current AND id IS DISTINCT FROM v_term_id;
      UPDATE public.terms SET is_current = true WHERE id = v_term_id;
    END IF;
  END IF;

  FOR v_teacher IN SELECT value FROM jsonb_array_elements(v_teachers) LOOP
    v_source_id := nullif(trim(v_teacher->>'sourceId'), '');
    v_name := nullif(trim(v_teacher->>'name'), '');
    v_title := nullif(trim(v_teacher->>'title'), '');
    v_campus := nullif(trim(v_teacher->>'campus'), '');
    v_college_code := nullif(trim(v_teacher->>'collegeCode'), '');

    IF v_source_id IS NULL OR char_length(v_source_id) > 120
       OR position('/' IN v_source_id) > 0 OR position(chr(92) IN v_source_id) > 0 THEN
      RAISE EXCEPTION '教师 sourceId 必填、不超过 120 字符且不能包含斜杠';
    END IF;
    IF v_name IS NULL OR char_length(v_name) > 80 THEN
      RAISE EXCEPTION '教师 % 的姓名必填且不超过 80 字符', v_source_id;
    END IF;
    IF v_title IS NOT NULL AND char_length(v_title) > 40 THEN
      RAISE EXCEPTION '教师 % 的职称超过 40 字符', v_source_id;
    END IF;
    IF v_campus IS NOT NULL AND v_campus NOT IN ('唐岛湾校区', '古镇口校区', '东营科教园区') THEN
      RAISE EXCEPTION '教师 % 的校区 % 不在 UPC 校区枚举中', v_source_id, v_campus;
    END IF;
    IF v_college_code IS NULL THEN
      RAISE EXCEPTION '教师 % 缺少 collegeCode', v_source_id;
    END IF;

    SELECT id INTO v_college_id FROM public.colleges WHERE code = v_college_code;
    IF v_college_id IS NULL THEN
      RAISE EXCEPTION '教师 % 的学院编码 % 不存在，请先导入学院字典', v_source_id, v_college_code;
    END IF;

    v_teacher_id := 'upc:' || v_source_id;
    IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = v_teacher_id) THEN
      INSERT INTO public.teachers (id, source_id, name, title, college_id, campus, rating_version)
      VALUES (v_teacher_id, v_source_id, v_name, v_title, v_college_id, v_campus, 2);
      v_teacher_inserted := v_teacher_inserted + 1;
    ELSE
      SELECT name, title, college_id, campus
      INTO v_current_name, v_current_title, v_current_college_id, v_current_campus
      FROM public.teachers WHERE id = v_teacher_id;

      -- Confirmed governance corrections are authoritative. A later batch may
      -- leave protected fields untouched but must never silently undo them.
      SELECT
        coalesce(bool_or(field_name = 'name'), false),
        coalesce(bool_or(field_name = 'title'), false),
        coalesce(bool_or(field_name = 'campus'), false),
        coalesce(bool_or(field_name = 'college_id'), false)
      INTO v_pin_name, v_pin_title, v_pin_campus, v_pin_college
      FROM private.upc_correction_pins
      WHERE target_table = 'teachers' AND target_id = v_teacher_id;

      IF v_pin_name AND v_name IS DISTINCT FROM v_current_name THEN
        v_name := v_current_name;
        v_teacher_protected := v_teacher_protected + 1;
      END IF;
      IF v_pin_title AND v_title IS DISTINCT FROM v_current_title THEN
        v_title := v_current_title;
        v_teacher_protected := v_teacher_protected + 1;
      END IF;
      IF v_pin_campus AND v_campus IS DISTINCT FROM v_current_campus THEN
        v_campus := v_current_campus;
        v_teacher_protected := v_teacher_protected + 1;
      END IF;
      IF v_pin_college THEN
        IF v_college_id IS DISTINCT FROM v_current_college_id THEN
          v_teacher_protected := v_teacher_protected + 1;
        END IF;
        v_college_id := v_current_college_id;
      END IF;

      SELECT (name = v_name
              AND title IS NOT DISTINCT FROM v_title
              AND college_id = v_college_id
              AND campus IS NOT DISTINCT FROM v_campus)
      INTO v_same
      FROM public.teachers WHERE id = v_teacher_id;

      IF v_same THEN
        v_teacher_skipped := v_teacher_skipped + 1;
      ELSE
        UPDATE public.teachers
        SET name = v_name, title = v_title, college_id = v_college_id, campus = v_campus
        WHERE id = v_teacher_id;
        v_teacher_updated := v_teacher_updated + 1;
      END IF;
    END IF;

    IF v_teacher ? 'courses' AND jsonb_typeof(v_teacher->'courses') <> 'array' THEN
      RAISE EXCEPTION '教师 % 的 courses 必须是数组', v_source_id;
    END IF;
    IF jsonb_array_length(coalesce(v_teacher->'courses', '[]'::jsonb)) > 0
       AND v_term IS NULL THEN
      RAISE EXCEPTION '教师 % 有课程但整批未提供 term', v_source_id;
    END IF;

    FOR v_course IN SELECT value FROM jsonb_array_elements(coalesce(v_teacher->'courses', '[]'::jsonb)) LOOP
      v_course_code := nullif(trim(v_course->>'code'), '');
      v_course_name := nullif(trim(v_course->>'name'), '');
      IF v_course_name IS NULL OR char_length(v_course_name) > 160 THEN
        RAISE EXCEPTION '教师 % 的课程名称必填且不超过 160 字符', v_source_id;
      END IF;
      IF v_course_code IS NOT NULL AND char_length(v_course_code) > 80 THEN
        RAISE EXCEPTION '教师 % 的课程代码超过 80 字符', v_source_id;
      END IF;

      -- The offering unit is separate from the teacher's HR college. It defaults
      -- to the teacher's college when not supplied.
      v_course_college_code := nullif(trim(v_course->>'collegeCode'), '');
      IF v_course_college_code IS NULL THEN
        v_course_college_id := v_college_id;
      ELSE
        SELECT id INTO v_course_college_id
        FROM public.colleges WHERE code = v_course_college_code;
        IF v_course_college_id IS NULL THEN
          RAISE EXCEPTION '教师 % 的课程 % 指定学院编码 % 不存在', v_source_id, v_course_name, v_course_college_code;
        END IF;
      END IF;

      v_course_id := NULL;
      v_existing_course_name := NULL;
      v_existing_course_college := NULL;

      IF v_course_code IS NOT NULL THEN
        SELECT id, name, college_id
        INTO v_course_id, v_existing_course_name, v_existing_course_college
        FROM public.courses WHERE code = v_course_code;

        IF v_course_id IS NOT NULL THEN
          SELECT
            coalesce(bool_or(field_name = 'name'), false),
            coalesce(bool_or(field_name = 'code'), false),
            coalesce(bool_or(field_name = 'college_id'), false)
          INTO v_pin_course_name, v_pin_course_code, v_pin_course_college
          FROM private.upc_correction_pins
          WHERE target_table = 'courses' AND target_id = v_course_id::text;

          IF v_existing_course_name IS DISTINCT FROM v_course_name THEN
            IF v_pin_course_name THEN
              v_course_name := v_existing_course_name;
              v_course_protected := v_course_protected + 1;
            ELSE
              RAISE EXCEPTION '课程代码 % 已存在名称 %，与本次名称 % 冲突',
                v_course_code, v_existing_course_name, v_course_name;
            END IF;
          END IF;
          IF v_existing_course_college IS DISTINCT FROM v_course_college_id THEN
            IF v_pin_course_college THEN
              v_course_college_id := v_existing_course_college;
              v_course_protected := v_course_protected + 1;
            ELSE
              RAISE EXCEPTION '课程代码 % 已归属其他学院，不能静默改归属', v_course_code;
            END IF;
          END IF;
          v_course_skipped := v_course_skipped + 1;
        ELSE
          -- A governance correction may have pinned this course's code. If the
          -- incoming source still uses the old code, fail closed instead of
          -- creating a duplicate course under the corrected catalog.
          SELECT c.id INTO v_pinned_code_course_id
          FROM private.upc_correction_pins p
          JOIN public.courses c ON c.id::text = p.target_id
          WHERE p.target_table = 'courses' AND p.field_name = 'code'
            AND c.name = v_course_name AND c.college_id = v_course_college_id
            AND p.corrected_value IS DISTINCT FROM to_jsonb(v_course_code)
          LIMIT 1;
          IF v_pinned_code_course_id IS NOT NULL THEN
            RAISE EXCEPTION '课程 % 的编码已由治理纠正固定，本次导入编码 % 与纠正结果冲突，请人工核对',
              v_course_name, v_course_code;
          END IF;

          -- Adopt a single uncoded course with the same name/college. If a coded
          -- same-name course also exists, the uncoded record is ambiguous.
          SELECT id INTO v_course_id
          FROM public.courses
          WHERE name = v_course_name AND college_id = v_course_college_id AND code IS NULL
          LIMIT 1;

          IF v_course_id IS NOT NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.courses
              WHERE name = v_course_name AND college_id = v_course_college_id AND code IS NOT NULL
            ) THEN
              RAISE EXCEPTION '课程 % 同时存在有编码和无编码记录，无法安全采用编码 %',
                v_course_name, v_course_code;
            END IF;
            UPDATE public.courses SET code = v_course_code WHERE id = v_course_id;
            v_course_updated := v_course_updated + 1;
          ELSE
            INSERT INTO public.courses (code, name, college_id)
            VALUES (v_course_code, v_course_name, v_course_college_id)
            RETURNING id INTO v_course_id;
            v_course_inserted := v_course_inserted + 1;
          END IF;
        END IF;
      ELSE
        -- Without a code, only an uncoded row can be matched. A coded same-name
        -- row makes the identity ambiguous and must not be duplicated.
        SELECT id INTO v_course_id
        FROM public.courses
        WHERE name = v_course_name AND college_id = v_course_college_id AND code IS NULL
        LIMIT 1;

        IF v_course_id IS NOT NULL THEN
          v_course_skipped := v_course_skipped + 1;
        ELSE
          IF EXISTS (
            SELECT 1 FROM public.courses
            WHERE name = v_course_name AND college_id = v_course_college_id AND code IS NOT NULL
          ) THEN
            RAISE EXCEPTION '课程 % 已有编码记录，无编码导入会产生歧义', v_course_name;
          END IF;
          INSERT INTO public.courses (code, name, college_id)
          VALUES (NULL, v_course_name, v_course_college_id)
          RETURNING id INTO v_course_id;
          v_course_inserted := v_course_inserted + 1;
        END IF;
      END IF;

      IF v_term_id IS NULL THEN
        RAISE EXCEPTION '教师 % 有课程但 term 未能建立', v_source_id;
      END IF;
      -- A confirmed removal is recorded as a relation pin. Re-import must not
      -- silently resurrect a relation that governance decided to delete.
      IF EXISTS (
        SELECT 1 FROM private.upc_correction_pins
        WHERE target_table = 'course_offerings'
          AND target_id = v_teacher_id || '|' || v_course_id::text || '|' || v_term_id::text
          AND field_name = 'relation'
          AND corrected_value->>'action' = 'removed'
      ) THEN
        v_offering_protected := v_offering_protected + 1;
      ELSE
        INSERT INTO public.course_offerings (teacher_id, course_id, term_id)
        VALUES (v_teacher_id, v_course_id, v_term_id)
        ON CONFLICT (teacher_id, course_id, term_id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 1 THEN
          v_offering_inserted := v_offering_inserted + 1;
        ELSE
          v_offering_skipped := v_offering_skipped + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  v_summary := jsonb_build_object(
    'success', true,
    'dryRun', false,
    'dataset', v_dataset,
    'source', v_source,
    'checksum', p_checksum,
    'term', jsonb_build_object(
      'inserted', v_term_inserted,
      'updated', v_term_updated,
      'skipped', v_term_skipped
    ),
    'teachers', jsonb_build_object(
      'inserted', v_teacher_inserted,
      'updated', v_teacher_updated,
      'skipped', v_teacher_skipped,
      'protectedFields', v_teacher_protected
    ),
    'courses', jsonb_build_object(
      'inserted', v_course_inserted,
      'updated', v_course_updated,
      'skipped', v_course_skipped,
      'protectedFields', v_course_protected
    ),
    'offerings', jsonb_build_object(
      'inserted', v_offering_inserted,
      'skipped', v_offering_skipped,
      'protectedRelations', v_offering_protected
    )
  );

  INSERT INTO public.import_batches (dataset, source, checksum, summary)
  VALUES (v_dataset, v_source, p_checksum, v_summary);

  RETURN v_summary;
END $$;
REVOKE ALL ON FUNCTION private.upc_import_dataset_apply(JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Dry run uses the same apply function in a subtransaction, then raises a private
-- sentinel to force a rollback. Other errors propagate unchanged, so a preflight
-- cannot report success for a batch that the real import would reject.
CREATE OR REPLACE FUNCTION public.import_upc_dataset(
  p_payload JSONB,
  p_checksum TEXT,
  p_dry_run BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_summary JSONB;
  v_detail TEXT;
BEGIN
  IF p_dry_run IS NOT TRUE THEN
    RETURN private.upc_import_dataset_apply(p_payload, p_checksum);
  END IF;

  BEGIN
    v_summary := private.upc_import_dataset_apply(p_payload, p_checksum);
    RAISE EXCEPTION USING ERRCODE = 'UP001', MESSAGE = 'UPC_DRY_RUN',
      DETAIL = (v_summary || jsonb_build_object('dryRun', true))::text;
  EXCEPTION WHEN SQLSTATE 'UP001' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN v_detail::jsonb;
  END;
END $$;

REVOKE ALL ON FUNCTION public.import_upc_dataset(JSONB, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.import_upc_dataset(JSONB, TEXT, BOOLEAN) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
