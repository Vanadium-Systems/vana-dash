CREATE TABLE "prospect_collaborators" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "ck_prospect_collaborators_level" CHECK ("prospect_collaborators"."level" IN ('view', 'edit'))
);
--> statement-breakpoint
CREATE TABLE "prospect_transfer_requests" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"kind" text DEFAULT 'transfer' NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ck_transfer_requests_kind" CHECK ("prospect_transfer_requests"."kind" IN ('transfer', 'access')),
	CONSTRAINT "ck_transfer_requests_status" CHECK ("prospect_transfer_requests"."status" IN ('pending', 'accepted', 'refused', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prospect_collaborators" ADD CONSTRAINT "prospect_collaborators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_collaborators" ADD CONSTRAINT "prospect_collaborators_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_collaborators" ADD CONSTRAINT "prospect_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ADD CONSTRAINT "prospect_transfer_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospect_collaborators" ON "prospect_collaborators" USING btree ("tenant_id","prospect_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_collaborators_user" ON "prospect_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transfer_pending" ON "prospect_transfer_requests" USING btree ("tenant_id","prospect_id","to_user_id","kind") WHERE "prospect_transfer_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
ALTER TABLE "prospect_collaborators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_collaborators" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_transfer_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_transfer_requests" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Nobody loses what they see today: everyone who can open Clients keeps seeing every prospect.
UPDATE "roles" SET "features" = array_append("features", 'clienti.toti') WHERE 'clienti.view' = ANY("features") AND NOT ('clienti.toti' = ANY("features"));
