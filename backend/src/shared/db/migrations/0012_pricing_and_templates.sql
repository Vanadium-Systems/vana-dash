CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"billing_client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"line_items" jsonb NOT NULL,
	"is_default_for_auto_invoice" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"platform_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	CONSTRAINT "pricing_configs_platform_id_unique" UNIQUE("platform_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invoice_templates_one_default_per_client" ON "invoice_templates" USING btree ("billing_client_id") WHERE "invoice_templates"."is_default_for_auto_invoice" AND "invoice_templates"."deleted_at" IS NULL;