-- UPC 2026-10-24 security upgrade: read-only preflight.
-- Run against the exact target database before taking a backup. Every query is
-- inside a read-only transaction; no table, role, policy or Auth object changes.
-- Abort the maintenance window if any "must be zero" query returns non-zero.
\echo '== target identity =='
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database, current_user AS role, version() AS postgres_version;
SELECT inet_server_addr() AS server_addr, inet_server_port() AS server_port;

\echo '== required base objects (must all be present) =='
SELECT
  to_regclass('public.teachers') IS NOT NULL AS teachers,
  to_regclass('public.courses') IS NOT NULL AS courses,
  to_regclass('public.course_offerings') IS NOT NULL AS offerings,
  to_regclass('public.reviews') IS NOT NULL AS reviews,
  to_regclass('public.governance_requests') IS NOT NULL AS governance_requests,
  to_regclass('private.upc_admin_audit_log') IS NOT NULL AS admin_audit_log,
  to_regclass('private.upc_security_settings') IS NOT NULL AS old_security_settings;

\echo '== expected pre-state: old security-governance only =='
SELECT
  to_regprocedure('public.apply_governance_correction(uuid,jsonb,text)') IS NULL
    AS correction_rpc_absent,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_proxy_teacher_appeal'
  ) AS old_appeal_rpc_present,
  to_regclass('private.upc_data_corrections') IS NULL AS correction_ledger_absent,
  to_regclass('private.upc_correction_pins') IS NULL AS correction_pins_absent;

\echo '== review uniqueness index before replacement =='
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

\echo '== governance request type constraint (historical teacher_appeal may remain) =='
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.governance_requests'::regclass AND contype = 'c'
ORDER BY conname;

\echo '== current data counts (record these; compare after upgrade) =='
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

\echo '== administrator domains (counts only; no email values) =='
SELECT split_part(email, '@', 2) AS domain, count(*) AS admins
FROM public.admin_users GROUP BY 1 ORDER BY 1;

\echo '== old administrator bindings that need an operator decision (count only) =='
SELECT count(*) AS non_gmail_admin_bindings
FROM public.admin_users
WHERE lower(split_part(email, '@', 2)) <> 'gmail.com';

\echo '== public review feed columns (must not contain identity/comment fields) =='
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'review_feed'
ORDER BY ordinal_position;

\echo '== patch files must exist and be reviewed before execution =='
-- This is an operator checklist, not a filesystem check:
-- 20261024-security-governance.sql
-- 20261024-owner-admin-policy.sql
-- 20261024-governance-boundary.sql
-- 20261024-remove-teacher-appeal.sql
-- 20261024-governance-correction-closure.sql
COMMIT;
