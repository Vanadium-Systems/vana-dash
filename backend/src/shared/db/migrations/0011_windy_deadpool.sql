CREATE TYPE "public"."billing_client_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "needs_billing_info" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_cycle" "billing_client_cycle";--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_cycle_day" integer;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_cycle_month" integer;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_due_date" date;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_reminder_7d_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_reminder_1d_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "billing_overdue_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billing_clients_slug_unique" ON "billing_clients" USING btree ("slug") WHERE "billing_clients"."slug" IS NOT NULL;