-- FORCE ROW LEVEL SECURITY on every table with a tenant_id, so the policies of 0073+ apply to the
-- table owner too. The app connects as vanadash_app (infra/rls-role.sql) when RLS_ENABLED=true;
-- the migrations and pg_dump run as the superuser, which RLS never applies to, so nothing changes
-- for them. platform_access_log is the platform's own log: its tenant_id is the company that was
-- visited, not the row's owner, and it has no policy on purpose.
-- A new table with tenant_id needs ENABLE + FORCE + the policy in its own migration;
-- shared/db/rls.test.ts fails otherwise.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
      AND c.table_name <> 'platform_access_log'
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
