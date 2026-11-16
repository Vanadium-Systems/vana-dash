ALTER TABLE "billing_clients" ADD COLUMN "iban_enc" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "iban_hmac" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "counterparty_iban_enc" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "counterparty_iban_hmac" text;--> statement-breakpoint
CREATE INDEX "ix_bank_transactions_iban_hmac" ON "bank_transactions" USING btree ("counterparty_iban_hmac");