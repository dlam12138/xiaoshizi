-- New submissions use six decimal scores in [4.0, 5.0].
-- Historical rows keep 1–5 values and are never backfilled or truncated.
-- The public view and triggers depend on these columns, so recreate them around
-- the type change.
DROP VIEW IF EXISTS public.review_feed;
DROP TRIGGER IF EXISTS trg_recalc_teacher_scores ON public.reviews;
DROP TRIGGER IF EXISTS reviews_check_rating_version ON public.reviews;

ALTER TABLE public.reviews
  ALTER COLUMN attendance_strictness TYPE NUMERIC USING attendance_strictness,
  ALTER COLUMN grading_leniency TYPE NUMERIC USING grading_leniency,
  ALTER COLUMN effort_matters TYPE NUMERIC USING effort_matters,
  ALTER COLUMN workload_difficulty TYPE NUMERIC USING workload_difficulty,
  ALTER COLUMN approachability TYPE NUMERIC USING approachability,
  ALTER COLUMN teaching_quality TYPE NUMERIC USING teaching_quality;

CREATE VIEW public.review_feed AS
SELECT
  r.id, r.teacher_id, r.course_id, r.term_id, r.year_term,
  r.attendance_strictness, r.grading_leniency, r.effort_matters,
  r.workload_difficulty, r.approachability, r.teaching_quality,
  r.comment, r.author_nickname, r.is_historical_migrated,
  r.status, r.created_at, r.likes, r.rating_version,
  c.name AS course_name,
  t.name AS teacher_name
FROM public.reviews r
LEFT JOIN public.courses c ON c.id = r.course_id
LEFT JOIN public.teachers t ON t.id = r.teacher_id
WHERE r.status = 'approved';
REVOKE ALL ON public.review_feed FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_feed TO anon, authenticated;

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
CREATE TRIGGER trg_recalc_teacher_scores
  AFTER INSERT OR DELETE OR UPDATE OF status, attendance_strictness, grading_leniency,
    effort_matters, workload_difficulty, approachability, teaching_quality
  ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recalc_teacher_scores();
CREATE TRIGGER reviews_check_rating_version
  BEFORE INSERT OR UPDATE OF rating_version, attendance_strictness, grading_leniency,
    effort_matters, workload_difficulty, approachability, teaching_quality
  ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION private.upc_check_rating_version();

UPDATE public.point_rules
SET label = '撰写课堂反馈审核通过'
WHERE action_code = 'review_approved';
ALTER TABLE public.admin_users
  ALTER COLUMN nickname SET DEFAULT '反馈审核员';
