-- Hosted Supabase did not inherit the local database's default grants for
-- tables created by `postgres`. Keep the same application-facing surface as
-- the local target: public catalog/feed readable; reviews have narrow column
-- writes; RPC-only tables are not directly writable.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON
  public.colleges,
  public.courses,
  public.course_offerings,
  public.terms,
  public.teachers,
  public.point_rules,
  public.review_feed
TO anon, authenticated;

GRANT SELECT ON
  public.reviews,
  public.review_likes,
  public.point_transactions,
  public.user_profiles,
  public.governance_requests,
  public.admin_directory,
  public.admin_review_queue,
  public.admin_governance_queue
TO authenticated;

-- Hosted PostgREST checks table-level INSERT/UPDATE for these writes; the
-- column grants below preserve the narrow surface, while RLS and the review
-- guard trigger still reject text comments and unauthorized rows.
GRANT INSERT, UPDATE ON public.reviews TO authenticated;

GRANT INSERT (
  id, teacher_id, course_id, term_id, year_term, rating_version,
  attendance_strictness, grading_leniency, effort_matters, workload_difficulty,
  approachability, teaching_quality, user_id, author_nickname, status, likes,
  is_historical_migrated
) ON public.reviews TO authenticated;

GRANT UPDATE (
  teacher_id, course_id, term_id, year_term, rating_version,
  attendance_strictness, grading_leniency, effort_matters, workload_difficulty,
  approachability, teaching_quality, status, reject_reason
) ON public.reviews TO authenticated;

GRANT DELETE ON public.reviews TO authenticated;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
