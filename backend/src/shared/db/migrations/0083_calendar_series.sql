CREATE TABLE "calendar_event_exceptions" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "calendar_exceptions_kind" CHECK ("calendar_event_exceptions"."kind" IN ('cancelled','moved'))
);
--> statement-breakpoint
CREATE TABLE "calendar_event_reminders" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"minutes_before" integer NOT NULL,
	"last_sent_occurrence" timestamp with time zone,
	CONSTRAINT "calendar_reminders_minutes" CHECK ("calendar_event_reminders"."minutes_before" BETWEEN 0 AND 40320)
);
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ADD CONSTRAINT "calendar_event_reminders_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_exceptions" ON "calendar_event_exceptions" USING btree ("tenant_id","event_id","occurrence_start");--> statement-breakpoint
CREATE INDEX "idx_calendar_exceptions_event" ON "calendar_event_exceptions" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_reminders" ON "calendar_event_reminders" USING btree ("tenant_id","event_id","minutes_before");--> statement-breakpoint
INSERT INTO "calendar_event_reminders" ("tenant_id", "event_id", "minutes_before", "last_sent_occurrence")
SELECT "tenant_id", "id", "reminder_minutes_before", "reminder_sent_at"
  FROM "calendar_events"
 WHERE "reminder_minutes_before" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "calendar_event_exceptions" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
ALTER TABLE "calendar_event_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "calendar_event_reminders" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
