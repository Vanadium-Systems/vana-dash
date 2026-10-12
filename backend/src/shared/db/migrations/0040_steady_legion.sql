ALTER TABLE "billing_clients" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "demo_ends_at" date;