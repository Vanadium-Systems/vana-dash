CREATE TYPE "public"."billing_client_currency" AS ENUM('lei', 'eur');--> statement-breakpoint
CREATE TABLE "vanagreen_extension_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"billing_client_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"months" integer NOT NULL,
	"status" text NOT NULL,
	"response_message" text
);
--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "vanagreen_tenant_id" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "vanagreen_extend_months" integer;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "subscription_price_lei" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "subscription_price_eur" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "subscription_price_currency" "billing_client_currency" DEFAULT 'lei' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "auto_invoice_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vanagreen_extension_log" ADD CONSTRAINT "vanagreen_extension_log_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vanagreen_extension_log_billing_client" ON "vanagreen_extension_log" USING btree ("billing_client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vanagreen_extension_log_source" ON "vanagreen_extension_log" USING btree ("source","source_id");