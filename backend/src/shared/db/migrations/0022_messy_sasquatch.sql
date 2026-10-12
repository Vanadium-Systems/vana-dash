ALTER TABLE "financial_records" ADD COLUMN "reverse_charge_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "counterparty_country" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "reverse_charge_vat_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "archive_folders" ADD COLUMN "hidden_from_accountant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_financial_records_reverse_charge" ON "financial_records" USING btree ("reverse_charge_type","issued_at");