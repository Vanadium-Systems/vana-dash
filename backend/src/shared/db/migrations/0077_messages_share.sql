CREATE TABLE "message_reactions" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "ck_message_reactions_emoji" CHECK (char_length("message_reactions"."emoji") <= 16)
);
--> statement-breakpoint
CREATE TABLE "message_refs" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"message_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_message_refs_type" CHECK ("message_refs"."ref_type" IN ('prospect', 'invoice', 'email_thread', 'calendar_event', 'archive_file', 'note'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "motion_pref" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hide_amounts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_refs" ADD CONSTRAINT "message_refs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_message_reactions" ON "message_reactions" USING btree ("tenant_id","message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "idx_message_reactions_message" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_refs_message" ON "message_refs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_refs_target" ON "message_refs" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_motion_pref" CHECK ("users"."motion_pref" IN ('system', 'full', 'reduced', 'off'));--> statement-breakpoint
ALTER TABLE "message_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "message_reactions" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
ALTER TABLE "message_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "message_refs" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
