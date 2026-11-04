CREATE TABLE "email_user_settings" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"outreach_daily_cap" integer,
	"signature_by_mailbox" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ck_email_user_settings_cap" CHECK ("email_user_settings"."outreach_daily_cap" IS NULL OR "email_user_settings"."outreach_daily_cap" >= 0)
);
--> statement-breakpoint
DROP INDEX "uq_email_labels_name";--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "kind" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "email_labels" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_rules" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "mode" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "source_message_id" uuid;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "cc" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_user_settings" ADD CONSTRAINT "email_user_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_user_settings" ADD CONSTRAINT "email_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_user_settings" ON "email_user_settings" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "email_labels" ADD CONSTRAINT "email_labels_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_rules" ADD CONSTRAINT "email_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_source_message_id_email_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_sends_scheduled" ON "email_sends" USING btree ("send_after") WHERE "email_sends"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_labels_company" ON "email_labels" USING btree ("tenant_id","name") WHERE "email_labels"."owner_user_id" IS NULL AND "email_labels"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_labels_owner" ON "email_labels" USING btree ("tenant_id","owner_user_id","name") WHERE "email_labels"."owner_user_id" IS NOT NULL AND "email_labels"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_email_messages_thread_created" ON "email_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_drafts_reply" ON "email_drafts" USING btree ("tenant_id","owner_user_id","thread_id","mode") WHERE "email_drafts"."thread_id" IS NOT NULL AND "email_drafts"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "ck_email_sends_kind" CHECK ("email_sends"."kind" IN ('single', 'reply', 'forward', 'draft', 'bulk', 'sequence'));--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "ck_email_drafts_mode" CHECK ("email_drafts"."mode" IN ('new', 'reply', 'reply_all', 'forward'));--> statement-breakpoint
UPDATE "email_sends" SET "kind" = CASE WHEN "sequence_enrollment_id" IS NOT NULL THEN 'sequence' WHEN "batch_id" IS NOT NULL THEN 'bulk' ELSE 'single' END;
--> statement-breakpoint
ALTER TABLE "email_user_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "email_user_settings" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
UPDATE "roles" SET "features" = array_append("features", 'email.setari_proprii') WHERE 'email.trimitere' = ANY("features") AND NOT ('email.setari_proprii' = ANY("features"));
