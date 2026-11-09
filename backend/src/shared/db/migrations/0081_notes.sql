CREATE TABLE "note_versions" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"note_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"body_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "title" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "body_format" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "body_json" jsonb;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "color" smallint;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_note_versions_note" ON "note_versions" USING btree ("note_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notes_labels" ON "notes" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "idx_notes_owner_state" ON "notes" USING btree ("owner_user_id","deleted_at","archived_at","pinned","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_body_format" CHECK ("notes"."body_format" IN ('plain','rich'));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_color_range" CHECK ("notes"."color" IS NULL OR "notes"."color" BETWEEN 1 AND 8);--> statement-breakpoint
ALTER TABLE "note_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "note_versions" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
