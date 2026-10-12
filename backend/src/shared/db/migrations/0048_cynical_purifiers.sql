CREATE TABLE "prospect_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color_token" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospect_statuses_key" ON "prospect_statuses" USING btree ("key") WHERE "prospect_statuses"."deleted_at" IS NULL;
--> statement-breakpoint
-- Seed din docs/HARDCODED_DATA_AUDIT.md §1 — snapshot exact al STATUS_OPTIONS/STATUS_LABELS/
-- STATUS_COLORS hardcodate curent în ProspectareTab.tsx, în aceeași ordine.
INSERT INTO "prospect_statuses" ("key", "label", "color_token", "sort_order", "is_default") VALUES
	('necontactat', 'Necontactat', 'slate', 0, true),
	('nu_a_raspuns', 'Nu a răspuns', 'amber', 1, false),
	('respins', 'Respins', 'red', 2, false),
	('de_revenit', 'De revenit', 'blue', 3, false),
	('whatsapp', 'WhatsApp', 'cyan', 4, false),
	('email', 'Email', 'cyan', 5, false),
	('aprobat', 'Aprobat', 'emerald', 6, false),
	('testing', 'Testing', 'purple', 7, false),
	('caz_particular', 'Caz particular', 'orange', 8, false),
	('nu_e_de_interes', 'Nu e de interes', 'gray', 9, false);
--> statement-breakpoint
-- Seed din docs/HARDCODED_DATA_AUDIT.md §3 — KPI-urile vizibile azi pe Overview (2 din
-- KPI_CARDS hardcodat + MRR adăugat manual separat în JSX).
INSERT INTO "dashboard_config" ("key", "value") VALUES
	('overview.visible_kpis', '["active_clients", "user_count", "mrr"]')
ON CONFLICT DO NOTHING;