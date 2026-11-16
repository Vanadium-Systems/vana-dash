-- The role the backend connects as when RLS_ENABLED=true (DATABASE_URL_APP). Idempotent: every
-- run re-applies the attributes and the grants. Expects the psql variables app_password, db and
-- owner (the role that runs the migrations and owns the tables). Run through scripts/rls-role.sh.
--
-- NOSUPERUSER NOBYPASSRLS: the policies apply to it. Not the table owner: FORCE ROW LEVEL
-- SECURITY (migration 0101) makes them apply to the owner as well, but the owner can still
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY, and this role must not be able to.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE vanadash_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vanadash_app') \gexec

ALTER ROLE vanadash_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO vanadash_app;
GRANT USAGE ON SCHEMA public TO vanadash_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vanadash_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vanadash_app;
-- Tables and sequences created by later migrations get the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vanadash_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vanadash_app;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'vanadash_app';
