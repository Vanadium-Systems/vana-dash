CREATE TABLE "tender_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"cpv_code" text,
	"cpv_description" text,
	"contracting_authority" text,
	"estimated_value_ron" numeric(14, 2),
	"procedure_type" text,
	"state_text" text,
	"is_open" boolean NOT NULL,
	"publication_date" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"detail_url" text NOT NULL,
	"matched_rule_id" uuid,
	"raw" jsonb NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tender_watch_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"label" text NOT NULL,
	"cpv_prefix" text,
	"keyword" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tender_opportunities" ADD CONSTRAINT "tender_opportunities_matched_rule_id_tender_watch_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."tender_watch_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tender_opp_source_external" ON "tender_opportunities" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "idx_tender_opp_deadline" ON "tender_opportunities" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "idx_tender_opp_is_open" ON "tender_opportunities" USING btree ("is_open");--> statement-breakpoint
-- Seed inițial reguli de urmărire (PLAN.md „Monitor licitații publice") — servicii IT, editabile
-- din UI imediat (pattern de-hardcodare 2026-08-20, nu rămân fixate în cod).
INSERT INTO "tender_watch_rules" ("label", "cpv_prefix", "keyword", "active") VALUES
	('Servicii IT (CPV 72)', '72', NULL, true),
	('Pachete software (CPV 48)', '48', NULL, true),
	('Dezvoltare software', NULL, 'dezvoltare software', true),
	('Digitalizare', NULL, 'digitalizare', true),
	('Aplicație informatică', NULL, 'aplicație informatică', true),
	('Platformă online', NULL, 'platformă online', true),
	('Website', NULL, 'website', true);