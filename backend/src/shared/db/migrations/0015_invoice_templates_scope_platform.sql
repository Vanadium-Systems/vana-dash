ALTER TABLE "invoice_templates" DROP CONSTRAINT "invoice_templates_billing_client_id_billing_clients_id_fk";
--> statement-breakpoint
DROP INDEX "idx_invoice_templates_one_default_per_client";--> statement-breakpoint
ALTER TABLE "invoice_templates" ALTER COLUMN "platform_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invoice_templates_one_default_per_platform" ON "invoice_templates" USING btree ("platform_id") WHERE "invoice_templates"."is_default_for_auto_invoice" AND "invoice_templates"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice_templates" DROP COLUMN "billing_client_id";