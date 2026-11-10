CREATE TABLE "prospect_voice_notes" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"author_user_id" uuid,
	"task_id" uuid,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_seconds" integer NOT NULL,
	"caption" text,
	CONSTRAINT "ck_prospect_voice_notes_duration" CHECK ("prospect_voice_notes"."duration_seconds" >= 0 AND "prospect_voice_notes"."duration_seconds" <= 900)
);
--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD COLUMN "invitees" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD COLUMN "invite_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_voice_notes" ADD CONSTRAINT "prospect_voice_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_voice_notes" ADD CONSTRAINT "prospect_voice_notes_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_voice_notes" ADD CONSTRAINT "prospect_voice_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_voice_notes" ADD CONSTRAINT "prospect_voice_notes_task_id_prospect_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."prospect_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospect_voice_notes_prospect" ON "prospect_voice_notes" USING btree ("tenant_id","prospect_id","created_at");--> statement-breakpoint
ALTER TABLE "prospect_voice_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_voice_notes" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
