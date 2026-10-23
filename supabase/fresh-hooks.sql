-- UPC triggers and like RPC. Apply after security.sql.

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

-- Recompute every dimension from approved reviews. With zero approved reviews the
-- averages are NULL, which clears stale scores instead of keeping an old value.
CREATE OR REPLACE FUNCTION public.recalc_teacher_scores() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_teacher_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_teacher_id := OLD.teacher_id;
  ELSE
    target_teacher_id := NEW.teacher_id;
  END IF;

  UPDATE public.teachers t
  SET
    review_count = a.review_count,
    attendance_strictness = a.attendance_strictness,
    grading_leniency = a.grading_leniency,
    effort_matters = a.effort_matters,
    workload_difficulty = a.workload_difficulty,
    approachability = a.approachability,
    teaching_quality = a.teaching_quality,
    overall_score = a.overall_score,
    updated_at = now()
  FROM (
    SELECT
      count(*)::int AS review_count,
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
    WHERE r.teacher_id = target_teacher_id
      AND r.status = 'approved'
  ) a
  WHERE t.id = target_teacher_id;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.recalc_teacher_scores() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_recalc_teacher_scores ON public.reviews;
CREATE TRIGGER trg_recalc_teacher_scores
  AFTER INSERT OR DELETE OR UPDATE OF status, attendance_strictness, grading_leniency,
    effort_matters, workload_difficulty, approachability, teaching_quality
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
    -- New submissions are six required decimal scores in [4.0, 5.0]. The
    -- columns are unconstrained NUMERIC so 4.15 reaches this check intact.
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

NOTIFY pgrst, 'reload schema';
