ALTER TABLE "billing_clients" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD COLUMN "default_payment_terms_days" integer DEFAULT 10 NOT NULL;