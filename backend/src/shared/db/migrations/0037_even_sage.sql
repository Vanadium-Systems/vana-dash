CREATE TABLE "contract_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"billing_client_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"issued_at" date NOT NULL,
	"old_price_note" text NOT NULL,
	"new_price_note" text NOT NULL,
	"reason" text NOT NULL,
	"effective_date_note" text NOT NULL,
	"temporary" boolean DEFAULT false NOT NULL,
	"reversion_note" text
);
--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"billing_client_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"addendum_id" uuid,
	"pdf_storage_path" text NOT NULL,
	"is_signed" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "contact_title" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "contract_plan" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "contract_details" jsonb;--> statement-breakpoint
ALTER TABLE "contract_addenda" ADD CONSTRAINT "contract_addenda_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_addendum_id_contract_addenda_id_fk" FOREIGN KEY ("addendum_id") REFERENCES "public"."contract_addenda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contract_addenda_client_number" ON "contract_addenda" USING btree ("billing_client_id","number") WHERE "contract_addenda"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contract_documents_client_type" ON "contract_documents" USING btree ("billing_client_id","doc_type","addendum_id");