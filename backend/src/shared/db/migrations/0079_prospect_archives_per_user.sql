CREATE TABLE "prospect_archives" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"prospect_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_archives_prospect_id_user_id_pk" PRIMARY KEY("prospect_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "prospect_archives" ADD CONSTRAINT "prospect_archives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_archives" ADD CONSTRAINT "prospect_archives_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_archives" ADD CONSTRAINT "prospect_archives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospect_archives_user" ON "prospect_archives" USING btree ("tenant_id","user_id");--> statement-breakpoint
-- Existing archives were shared; the archive endpoint never recorded who did it, so the row goes to
-- the last person who touched the prospect, else its creator, else the platform admin.
INSERT INTO "prospect_archives" ("tenant_id", "prospect_id", "user_id", "archived_at")
SELECT p."tenant_id", p."id", u."id", p."archived_at"
FROM "prospects" p
JOIN "users" u ON u."id" = COALESCE(
  p."updated_by_user_id",
  p."created_by_user_id",
  (SELECT a."id" FROM "users" a WHERE a."is_platform_admin" AND a."deleted_at" IS NULL ORDER BY a."created_at" LIMIT 1)
)
WHERE p."archived_at" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "prospect_archives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_archives" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
ALTER TABLE "prospects" DROP COLUMN "archived_at";