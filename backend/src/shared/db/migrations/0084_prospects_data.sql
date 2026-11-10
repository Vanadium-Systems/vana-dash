CREATE TABLE "prospect_contact_points" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"person_id" uuid,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"value_normalized" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	CONSTRAINT "ck_contact_points_kind" CHECK ("prospect_contact_points"."kind" IN ('phone', 'email')),
	CONSTRAINT "ck_contact_points_status" CHECK ("prospect_contact_points"."status" IN ('ok', 'bounced', 'unsubscribed', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "prospect_notes" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_people" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"do_not_contact_reason" text,
	"position" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_tasks" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"prospect_id" uuid NOT NULL,
	"person_id" uuid,
	"assignee_user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"done_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"calendar_event_id" uuid,
	"outcome" text,
	"outcome_note" text,
	CONSTRAINT "ck_prospect_tasks_kind" CHECK ("prospect_tasks"."kind" IN ('call', 'email', 'meeting', 'task', 'linkedin_connect', 'linkedin_message', 'linkedin_view', 'linkedin_engage')),
	CONSTRAINT "ck_prospect_tasks_priority" CHECK ("prospect_tasks"."priority" IN ('low', 'medium', 'high')),
	CONSTRAINT "ck_prospect_tasks_outcome" CHECK ("prospect_tasks"."outcome" IS NULL OR "prospect_tasks"."outcome" IN ('answered', 'no_answer', 'voicemail', 'wrong_number', 'callback'))
);
--> statement-breakpoint
ALTER TABLE "prospect_scoring_config" ADD COLUMN "base_weight" numeric(3, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_scoring_config" ADD COLUMN "criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_scoring_config" ADD COLUMN "labels" jsonb;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "value_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "value_currency" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "expected_close_at" date;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "is_active" boolean;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "cif_normalized" text GENERATED ALWAYS AS (upper(regexp_replace(coalesce(cif, ''), '^[[:space:]]*RO|[[:space:]]', '', 'gi'))) STORED;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "revenue_prev" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "revenue_year" smallint;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "score_base" numeric(5, 1);--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect_statuses" ADD COLUMN "kind" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_contact_points" ADD CONSTRAINT "prospect_contact_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_contact_points" ADD CONSTRAINT "prospect_contact_points_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_contact_points" ADD CONSTRAINT "prospect_contact_points_person_id_prospect_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."prospect_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_notes" ADD CONSTRAINT "prospect_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_notes" ADD CONSTRAINT "prospect_notes_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_notes" ADD CONSTRAINT "prospect_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_people" ADD CONSTRAINT "prospect_people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_people" ADD CONSTRAINT "prospect_people_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_person_id_prospect_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."prospect_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tasks" ADD CONSTRAINT "prospect_tasks_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contact_points_lookup" ON "prospect_contact_points" USING btree ("tenant_id","kind","value_normalized");--> statement-breakpoint
CREATE INDEX "idx_contact_points_prospect" ON "prospect_contact_points" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_notes_prospect" ON "prospect_notes" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prospect_people_prospect" ON "prospect_people" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_tasks_open" ON "prospect_tasks" USING btree ("prospect_id","due_at") WHERE "prospect_tasks"."done_at" IS NULL AND "prospect_tasks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_prospect_tasks_assignee" ON "prospect_tasks" USING btree ("assignee_user_id","due_at") WHERE "prospect_tasks"."done_at" IS NULL AND "prospect_tasks"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_merged_into_id_prospects_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospects_cif_normalized" ON "prospects" USING btree ("tenant_id","cif_normalized");--> statement-breakpoint
CREATE INDEX "idx_prospects_owner_activity" ON "prospects" USING btree ("tenant_id","assigned_user_id","last_activity_at");--> statement-breakpoint
ALTER TABLE "prospect_statuses" ADD CONSTRAINT "ck_prospect_statuses_kind" CHECK ("prospect_statuses"."kind" IN ('open', 'won', 'lost'));--> statement-breakpoint
UPDATE "prospects" SET "status_changed_at" = "updated_at", "score_base" = "score", "last_activity_at" = "last_contacted_at";--> statement-breakpoint
UPDATE "prospects" SET "claimed_at" = "updated_at" WHERE "assigned_user_id" IS NOT NULL;--> statement-breakpoint
UPDATE "prospect_statuses" SET "kind" = 'won' WHERE "key" = 'aprobat';--> statement-breakpoint
UPDATE "prospect_statuses" SET "kind" = 'lost' WHERE "key" IN ('pierdut', 'refuzat', 'neinteresat', 'respins', 'nu_e_de_interes');--> statement-breakpoint
-- The free-text contact columns move into people and contact points. The old columns stay (no
-- longer read) and are dropped in a later deploy, so a rollback still finds them.
INSERT INTO "prospect_people" ("tenant_id", "prospect_id", "name", "created_at", "updated_at")
SELECT "tenant_id", "id", btrim("contact_name"), "created_at", "updated_at"
  FROM "prospects"
 WHERE coalesce(btrim("contact_name"), '') <> '';--> statement-breakpoint
INSERT INTO "prospect_contact_points" ("tenant_id", "prospect_id", "person_id", "kind", "value", "value_normalized", "is_primary")
SELECT p."tenant_id", p."id", pp."id", parts.kind, parts.value,
       CASE parts.kind
         WHEN 'email' THEN lower(parts.value)
         ELSE CASE
           WHEN parts.digits ~ '^0040[0-9]{9}$' THEN '+' || substr(parts.digits, 3)
           WHEN parts.digits ~ '^40[0-9]{9}$' THEN '+' || parts.digits
           WHEN parts.digits ~ '^0[0-9]{9}$' THEN '+40' || substr(parts.digits, 2)
           WHEN parts.digits <> '' THEN '+' || parts.digits
           ELSE lower(parts.value)
         END
       END,
       parts.ord = 1
  FROM "prospects" p
  LEFT JOIN "prospect_people" pp ON pp."prospect_id" = p."id"
  CROSS JOIN LATERAL (
    SELECT 'phone' AS kind, btrim(v) AS value, regexp_replace(v, '[^0-9]', '', 'g') AS digits, ord
      FROM regexp_split_to_table(coalesce(p."phone", ''), '[/,;]') WITH ORDINALITY AS t(v, ord)
     WHERE btrim(v) <> ''
    UNION ALL
    SELECT 'email', btrim(v), '', ord
      FROM regexp_split_to_table(coalesce(p."email", ''), '[/,;[:space:]]+') WITH ORDINALITY AS t(v, ord)
     WHERE btrim(v) <> ''
  ) parts;--> statement-breakpoint
INSERT INTO "prospect_notes" ("tenant_id", "prospect_id", "body", "pinned", "created_at", "updated_at")
SELECT "tenant_id", "id", "notes", true, "updated_at", "updated_at"
  FROM "prospects"
 WHERE coalesce(btrim("notes"), '') <> '';--> statement-breakpoint
-- CIFs that only differ by "RO" or spaces. Not merged here (they may belong to different
-- people); the data health tab merges them and the unique index comes after.
DO $$
DECLARE collisions integer;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT 1 FROM "prospects"
     WHERE "deleted_at" IS NULL AND "cif_normalized" <> ''
     GROUP BY "tenant_id", "cif_normalized" HAVING count(*) > 1
  ) c;
  RAISE NOTICE 'prospects: % normalized CIF collisions', collisions;
END $$;--> statement-breakpoint
ALTER TABLE "prospect_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_people" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_contact_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_contact_points" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_notes" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "prospect_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prospect_tasks" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
