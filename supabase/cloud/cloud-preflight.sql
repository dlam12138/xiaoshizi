-- UPC managed-Supabase read-only preflight.
-- Run before applying supabase/cloud/upc-cloud-schema.sql.
-- This file does not write; it fails closed by exposing unexpected existing data.
BEGIN TRANSACTION READ ONLY;

\echo '== database identity =='
SELECT current_database() AS database, current_user AS role,
       current_setting('server_version') AS server_version,
       inet_server_addr() AS server_addr, inet_server_port() AS server_port;

\echo '== existing public tables and exact row counts =='
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

\echo '== public object inventory (must be empty on a new project) =='
SELECT c.relkind, count(*) AS n
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
GROUP BY c.relkind ORDER BY c.relkind;

\echo '== Auth data (must be empty for a new project) =='
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM auth.identities) AS auth_identities,
  (SELECT count(*) FROM auth.mfa_factors) AS mfa_factors,
  (SELECT count(*) FROM auth.sessions) AS sessions;

\echo '== expected UPC objects before migration (should be absent) =='
SELECT
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private') AS private_schema,
  to_regprocedure('public.apply_governance_correction(uuid,jsonb,text)') IS NOT NULL AS correction_rpc,
  to_regprocedure('public.before_user_created_hook(jsonb)') IS NOT NULL AS auth_hook;

\echo '== required platform roles =='
SELECT rolname FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role','supabase_auth_admin','postgres')
ORDER BY rolname;

COMMIT;
