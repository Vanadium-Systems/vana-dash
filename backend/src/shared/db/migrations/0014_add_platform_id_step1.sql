ALTER TABLE "billing_clients" ADD COLUMN "platform_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD COLUMN "platform_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD CONSTRAINT "billing_clients_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill manual (nu generat de drizzle-kit): clienții deja mapați la un tenant vanagreen
-- aparțin implicit platformei "vanagreen" — evită să rămână orfani fără platformId după migrare.
UPDATE "billing_clients" SET "platform_id" = (SELECT "id" FROM "platforms" WHERE "type" = 'vanagreen' LIMIT 1)
WHERE "vanagreen_tenant_id" IS NOT NULL AND "platform_id" IS NULL;