CREATE TABLE "invoice_payments" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"record_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"paid_at" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"bank_transaction_id" uuid,
	"created_by_user_id" uuid,
	CONSTRAINT "ck_invoice_payments_amount" CHECK ("invoice_payments"."amount" > 0),
	CONSTRAINT "ck_invoice_payments_method" CHECK ("invoice_payments"."method" IN ('bank','cash','card','other'))
);
--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "corrects_record_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "converted_to_record_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "proforma_status" text;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_record_id_financial_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."financial_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_payments_record" ON "invoice_payments" USING btree ("record_id") WHERE "invoice_payments"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_corrects_record_id_financial_records_id_fk" FOREIGN KEY ("corrects_record_id") REFERENCES "public"."financial_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_converted_to_record_id_financial_records_id_fk" FOREIGN KEY ("converted_to_record_id") REFERENCES "public"."financial_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_payment_id_invoice_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."invoice_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_financial_records_corrects" ON "financial_records" USING btree ("corrects_record_id") WHERE "financial_records"."corrects_record_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "ck_financial_records_proforma_status" CHECK ("financial_records"."proforma_status" IN ('open','invoiced','cancelled'));--> statement-breakpoint
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_payments" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Backfill: 'paid' -> one payment for the full amount ('bank' if the record has a live match, else 'other').
CREATE TEMP TABLE _paid_backfill AS
SELECT fr.id AS record_id, gen_random_uuid() AS payment_id, fr.tenant_id, fr.amount, fr.currency,
       (COALESCE(fr.paid_at, fr.issued_at, fr.created_at) AT TIME ZONE t.time_zone)::date AS paid_at,
       (SELECT pm.bank_transaction_id FROM payment_matches pm
          WHERE pm.financial_record_id = fr.id AND pm.deleted_at IS NULL ORDER BY pm.matched_at LIMIT 1) AS bank_transaction_id
FROM financial_records fr
JOIN tenants t ON t.id = fr.tenant_id
WHERE fr.payment_status = 'paid' AND fr.deleted_at IS NULL AND fr.amount > 0;--> statement-breakpoint
INSERT INTO invoice_payments (id, tenant_id, record_id, amount, currency, paid_at, method, bank_transaction_id)
SELECT payment_id, tenant_id, record_id, amount, currency, paid_at,
       CASE WHEN bank_transaction_id IS NULL THEN 'other' ELSE 'bank' END, bank_transaction_id
FROM _paid_backfill;--> statement-breakpoint
UPDATE payment_matches pm SET payment_id = b.payment_id
FROM _paid_backfill b
WHERE pm.financial_record_id = b.record_id AND pm.deleted_at IS NULL AND b.bank_transaction_id IS NOT NULL;--> statement-breakpoint
-- 'partial' -> one payment per live match, for the matched transaction's amount. A partial record without a match gets no payment.
CREATE TEMP TABLE _partial_backfill AS
SELECT pm.id AS match_id, gen_random_uuid() AS payment_id, fr.id AS record_id, fr.tenant_id, fr.currency,
       abs(bt.amount) AS amount, (bt.value_date AT TIME ZONE t.time_zone)::date AS paid_at, bt.id AS bank_transaction_id
FROM financial_records fr
JOIN payment_matches pm ON pm.financial_record_id = fr.id AND pm.deleted_at IS NULL
JOIN bank_transactions bt ON bt.id = pm.bank_transaction_id
JOIN tenants t ON t.id = fr.tenant_id
WHERE fr.payment_status = 'partial' AND fr.deleted_at IS NULL AND bt.amount <> 0;--> statement-breakpoint
INSERT INTO invoice_payments (id, tenant_id, record_id, amount, currency, paid_at, method, bank_transaction_id)
SELECT payment_id, tenant_id, record_id, amount, currency, paid_at, 'bank', bank_transaction_id
FROM _partial_backfill;--> statement-breakpoint
UPDATE payment_matches pm SET payment_id = b.payment_id
FROM _partial_backfill b WHERE pm.id = b.match_id;
--> statement-breakpoint
DROP TABLE _paid_backfill;--> statement-breakpoint
DROP TABLE _partial_backfill;
