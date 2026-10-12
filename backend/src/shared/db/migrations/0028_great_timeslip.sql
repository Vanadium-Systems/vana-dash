CREATE TABLE "prospect_scoring_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"budget_weight" numeric(4, 3) DEFAULT '0.25' NOT NULL,
	"need_weight" numeric(4, 3) DEFAULT '0.30' NOT NULL,
	"tech_weight" numeric(4, 3) DEFAULT '0.25' NOT NULL,
	"contact_weight" numeric(4, 3) DEFAULT '0.20' NOT NULL,
	"hot_threshold" numeric(5, 1) DEFAULT '65' NOT NULL,
	"warm_threshold" numeric(5, 1) DEFAULT '50' NOT NULL,
	"nurture_threshold" numeric(5, 1) DEFAULT '35' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"cif" text,
	"phone" text,
	"email" text,
	"website" text,
	"contact_name" text,
	"caen_code" text,
	"founding_year" integer,
	"employee_count" integer,
	"revenue" numeric(14, 2),
	"profit" numeric(14, 2),
	"debt" numeric(14, 2),
	"equity" numeric(14, 2),
	"cash" numeric(14, 2),
	"receivables" numeric(14, 2),
	"inventory" numeric(14, 2),
	"score" numeric(5, 1),
	"status" text DEFAULT 'necontactat' NOT NULL,
	"contacted_by" text,
	"notes" text,
	"source" text,
	"platform_id" uuid,
	"billing_client_id" uuid,
	"last_contacted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospects_score" ON "prospects" USING btree ("score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_prospects_status" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prospects_cif" ON "prospects" USING btree ("cif") WHERE "prospects"."cif" IS NOT NULL;