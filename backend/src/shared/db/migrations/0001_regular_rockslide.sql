CREATE TABLE "anaf_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"cif" text NOT NULL,
	"cert_alias" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	CONSTRAINT "anaf_credentials_cif_unique" UNIQUE("cif")
);
--> statement-breakpoint
CREATE TABLE "billing_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"cif" text NOT NULL,
	"reg_com" text,
	"address" text NOT NULL,
	"city" text,
	"county" text,
	"country" text DEFAULT 'RO' NOT NULL,
	"iban" text,
	"bank" text,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" text DEFAULT 'invoice' NOT NULL,
	"prefix" text DEFAULT 'VAN' NOT NULL,
	"separator" text DEFAULT '-' NOT NULL,
	"year_format" text DEFAULT 'yyyy' NOT NULL,
	"padding" integer DEFAULT 4 NOT NULL,
	"start_from" integer DEFAULT 1 NOT NULL,
	"reset_on" text DEFAULT 'year' NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"last_reset_year" integer,
	CONSTRAINT "invoice_sequences_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"account_ref" text,
	"currency" text DEFAULT 'RON' NOT NULL,
	"api_key_enc" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"health_status" text DEFAULT 'unknown' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"bank_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"counterparty_name" text,
	"counterparty_iban" text,
	"reference" text,
	"value_date" timestamp with time zone NOT NULL,
	"direction" text NOT NULL,
	"raw_meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "payment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"bank_transaction_id" uuid NOT NULL,
	"financial_record_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '1' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_log" ALTER COLUMN "platform_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN "job_key" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "direction" text DEFAULT 'out' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "document_number" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "billing_client_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "counterparty_name" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "counterparty_cif" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "anaf_message_id" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "anaf_upload_id" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "anaf_status" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "xml_storage_path" text;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "pdf_storage_path" text;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_financial_records_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."financial_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_financial_record_id_financial_records_id_fk" FOREIGN KEY ("financial_record_id") REFERENCES "public"."financial_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_transactions_external" ON "bank_transactions" USING btree ("bank_account_id","external_id");--> statement-breakpoint
CREATE INDEX "ix_bank_transactions_value_date" ON "bank_transactions" USING btree ("bank_account_id","value_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_matches_txn" ON "payment_matches" USING btree ("bank_transaction_id");--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sync_log_job_key" ON "sync_log" USING btree ("job_key","started_at");--> statement-breakpoint
CREATE INDEX "ix_financial_records_payment" ON "financial_records" USING btree ("direction","payment_status");--> statement-breakpoint
CREATE INDEX "ix_financial_records_anaf_status" ON "financial_records" USING btree ("anaf_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_records_doc_number" ON "financial_records" USING btree ("document_number");--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_anaf_message_id_unique" UNIQUE("anaf_message_id");