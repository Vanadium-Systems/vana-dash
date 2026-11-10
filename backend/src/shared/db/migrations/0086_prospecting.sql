CREATE TABLE "prospect_list_folders" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_list_members" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"list_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"added_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "prospect_lists" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"folder_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_stage_events" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_user_id" uuid,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_view_stars" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"view_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_views" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'companies' NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb,
	"calcs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"layout" text DEFAULT 'list' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"notify_new" boolean DEFAULT false NOT NULL,
	"last_notified_at" timestamp with time zone,
	CONSTRAINT "ck_prospect_views_kind" CHECK ("prospect_views"."kind" IN ('companies', 'people')),
	CONSTRAINT "ck_prospect_views_layout" CHECK ("prospect_views"."layout" IN ('list', 'board', 'forecast'))
);
--> statement-breakpoint
CREATE TABLE "text_snippets" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_list_folders" ADD CONSTRAINT "prospect_list_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_list_folders" ADD CONSTRAINT "prospect_list_folders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_list_members" ADD CONSTRAINT "prospect_list_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_list_members" ADD CONSTRAINT "prospect_list_members_list_id_prospect_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prospect_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_list_members" ADD CONSTRAINT "prospect_list_members_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_list_members" ADD CONSTRAINT "prospect_list_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_lists" ADD CONSTRAINT "prospect_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_lists" ADD CONSTRAINT "prospect_lists_folder_id_prospect_list_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."prospect_list_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_lists" ADD CONSTRAINT "prospect_lists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_stage_events" ADD CONSTRAINT "prospect_stage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_stage_events" ADD CONSTRAINT "prospect_stage_events_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_stage_events" ADD CONSTRAINT "prospect_stage_events_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_view_stars" ADD CONSTRAINT "prospect_view_stars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_view_stars" ADD CONSTRAINT "prospect_view_stars_view_id_prospect_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."prospect_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_view_stars" ADD CONSTRAINT "prospect_view_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_views" ADD CONSTRAINT "prospect_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_views" ADD CONSTRAINT "prospect_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_snippets" ADD CONSTRAINT "text_snippets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_snippets" ADD CONSTRAINT "text_snippets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospect_list_members" ON "prospect_list_members" USING btree ("tenant_id","list_id","prospect_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_list_members_prospect" ON "prospect_list_members" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_stage_events" ON "prospect_stage_events" USING btree ("tenant_id","changed_at","to_status");--> statement-breakpoint
CREATE INDEX "idx_stage_events_prospect" ON "prospect_stage_events" USING btree ("prospect_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospect_view_stars" ON "prospect_view_stars" USING btree ("tenant_id","view_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_views_owner" ON "prospect_views" USING btree ("tenant_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "prospect_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_views" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_view_stars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_view_stars" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_list_folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_list_folders" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_lists" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_list_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_list_members" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_stage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_stage_events" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "text_snippets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "text_snippets" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Status changes were never audited, so the history starts with each prospect's current stage.
INSERT INTO "prospect_stage_events" ("tenant_id", "prospect_id", "from_status", "to_status", "changed_at")
SELECT "tenant_id", "id", NULL, "status", "status_changed_at" FROM "prospects";
