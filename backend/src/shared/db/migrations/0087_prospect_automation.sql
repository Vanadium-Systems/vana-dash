CREATE TABLE "prospect_automation_rules" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rule_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_count" integer
);
--> statement-breakpoint
CREATE TABLE "prospect_signal_hits" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"signal_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_signals" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"group_key" text NOT NULL,
	"description" text,
	"filters" jsonb NOT NULL,
	"talking_tip" text,
	"builtin_key" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence_enrollments" ADD COLUMN "waiting_task_id" uuid;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD COLUMN "kind" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD COLUMN "variant_b_template_id" uuid;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD COLUMN "task_title" text;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD COLUMN "task_description" text;--> statement-breakpoint
ALTER TABLE "email_sequences" ADD COLUMN "stop_on_meeting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequences" ADD COLUMN "stop_on_won_lost" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequences" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "email_sequences" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "sequence_step_id" uuid;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "prospect_automation_rules" ADD CONSTRAINT "prospect_automation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signal_hits" ADD CONSTRAINT "prospect_signal_hits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signal_hits" ADD CONSTRAINT "prospect_signal_hits_signal_id_prospect_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."prospect_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signal_hits" ADD CONSTRAINT "prospect_signal_hits_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_signals" ADD CONSTRAINT "prospect_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_rule" ON "prospect_automation_rules" USING btree ("tenant_id","rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_signal_hits" ON "prospect_signal_hits" USING btree ("tenant_id","signal_id","prospect_id");--> statement-breakpoint
CREATE INDEX "idx_signal_hits_prospect" ON "prospect_signal_hits" USING btree ("prospect_id");--> statement-breakpoint
ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_waiting_task_id_prospect_tasks_id_fk" FOREIGN KEY ("waiting_task_id") REFERENCES "public"."prospect_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "email_sequence_steps_variant_b_template_id_email_templates_id_fk" FOREIGN KEY ("variant_b_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_sends_sequence_step" ON "email_sends" USING btree ("sequence_step_id") WHERE "email_sends"."sequence_step_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "ck_email_sequence_steps_kind" CHECK ("email_sequence_steps"."kind" IN ('email', 'call', 'task', 'linkedin_connect', 'linkedin_message', 'linkedin_view', 'linkedin_engage'));--> statement-breakpoint
ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "ck_email_sequence_steps_template" CHECK ("email_sequence_steps"."kind" <> 'email' OR "email_sequence_steps"."template_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "ck_email_sends_variant" CHECK ("email_sends"."variant" IS NULL OR "email_sends"."variant" IN ('A', 'B'));--> statement-breakpoint
ALTER TABLE "prospect_automation_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_automation_rules" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_signals" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_signal_hits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_signal_hits" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
