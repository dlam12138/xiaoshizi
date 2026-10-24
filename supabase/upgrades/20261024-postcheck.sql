-- UPC 2026-10-24 security upgrade: read-only post-check.
-- Run after all five patches and the GoTrue restart. It verifies schema,
-- privileges, public projections and data counts; it does not prove Auth Hook
-- configuration, which is checked separately in the runbook.
BEGIN TRANSACTION READ ONLY;

\echo '== upgrade objects =='
SELECT
  to_regprocedure('public.apply_governance_correction(uuid,jsonb,text)') IS NOT NULL
    AS correction_rpc,
  to_regprocedure('public.record_admin_mfa_recovery(uuid,text,text,text[])') IS NOT NULL
    AS mfa_recovery_rpc,
  to_regprocedure('private.upc_session_is_current()') IS NOT NULL
    AS admin_session_guard,
  to_regclass('private.upc_data_corrections') IS NOT NULL AS correction_ledger,
  to_regclass('private.upc_correction_pins') IS NOT NULL AS correction_pins,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_proxy_teacher_appeal'
  ) AS old_appeal_rpc_present,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.reviews'::regclass AND tgname = 'reviews_guard_business'
  ) AS review_guard_trigger,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'upc_guard_review_write'
  ) AS review_guard_function;

\echo '== review uniqueness predicate =='
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'reviews_business_key_uidx';

\echo '== active duplicate business groups (must be 0) =='
SELECT count(*) AS duplicate_business_groups
FROM (
  SELECT user_id, teacher_id, course_id, term_id
  FROM public.reviews
  WHERE user_id IS NOT NULL AND status <> 'withdrawn'
  GROUP BY user_id, teacher_id, course_id, term_id
  HAVING count(*) > 1
) duplicates;

\echo '== RLS and policies on protected tables =='
SELECT c.relname, c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('teachers','courses','course_offerings','reviews','review_likes',
                    'governance_requests','admin_users','user_profiles','point_transactions')
ORDER BY c.relname;

\echo '== public review feed must not expose identity or text =='
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='review_feed'
ORDER BY ordinal_position;

\echo '== correction and MFA privileges =='
SELECT
  has_function_privilege('anon', 'public.apply_governance_correction(uuid,jsonb,text)', 'EXECUTE')
    AS anon_can_apply_correction,
  has_function_privilege('authenticated', 'public.apply_governance_correction(uuid,jsonb,text)', 'EXECUTE')
    AS authenticated_can_apply_correction,
  has_function_privilege('anon', 'public.record_admin_mfa_recovery(uuid,text,text,text[])', 'EXECUTE')
    AS anon_can_recover_mfa,
  has_function_privilege('authenticated', 'public.record_admin_mfa_recovery(uuid,text,text,text[])', 'EXECUTE')
    AS authenticated_can_recover_mfa,
  has_function_privilege('service_role', 'public.record_admin_mfa_recovery(uuid,text,text,text[])', 'EXECUTE')
    AS service_role_can_recover_mfa,
  has_function_privilege('authenticated', 'private.upc_session_is_current()', 'EXECUTE')
    AS authenticated_can_call_session_guard;

\echo '== data counts after upgrade (business counts must equal preflight; auth/admin may change only for approved bootstrap) =='
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.teachers) AS teachers,
  (SELECT count(*) FROM public.courses) AS courses,
  (SELECT count(*) FROM public.course_offerings) AS offerings,
  (SELECT count(*) FROM public.reviews) AS reviews,
  (SELECT count(*) FROM public.reviews WHERE status = 'approved') AS approved_reviews,
  (SELECT count(*) FROM public.governance_requests) AS governance_requests,
  (SELECT count(*) FROM public.point_transactions) AS point_transactions,
  (SELECT count(*) FROM public.review_likes) AS review_likes,
  (SELECT count(*) FROM public.admin_users) AS admin_users;

\echo '== new private tables should be empty on first install =='
SELECT
  (SELECT count(*) FROM private.upc_data_corrections) AS corrections,
  (SELECT count(*) FROM private.upc_correction_pins) AS pins,
  (SELECT count(*) FROM private.upc_admin_audit_log WHERE action='admin_mfa_recovery') AS mfa_recovery_audits;

\echo '== administrator domains (counts only; operator decides old rows) =='
SELECT split_part(email, '@', 2) AS domain, count(*) AS admins
FROM public.admin_users GROUP BY 1 ORDER BY 1;

\echo '== security settings =='
SELECT key, value FROM private.upc_security_settings
WHERE key IN ('require_admin_aal2','min_independent_reviews','review_rate_seconds')
ORDER BY key;

\echo '== queue projection columns =='
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_governance_queue'
ORDER BY ordinal_position;

COMMIT;
