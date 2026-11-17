CREATE TABLE "livekit_settings" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"url" text DEFAULT '' NOT NULL,
	"api_key_enc" text,
	"api_secret_enc" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_refs" DROP CONSTRAINT "ck_message_refs_type";--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "room_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "kind" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "provider" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "provider" SET DEFAULT 'livekit';--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "guest_key_enc" text;--> statement-breakpoint
ALTER TABLE "livekit_settings" ADD CONSTRAINT "livekit_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_livekit_settings_tenant" ON "livekit_settings" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_calls_conversation" ON "calls" USING btree ("conversation_id") WHERE conversation_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "ck_message_refs_type" CHECK ("message_refs"."ref_type" IN ('prospect', 'invoice', 'email_thread', 'calendar_event', 'archive_file', 'note', 'call'));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "ck_calls_kind" CHECK ("calls"."kind" IN ('audio', 'video'));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "ck_calls_provider" CHECK ("calls"."provider" IN ('daily', 'livekit'));
--> statement-breakpoint
ALTER TABLE "livekit_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "livekit_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "livekit_settings" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');