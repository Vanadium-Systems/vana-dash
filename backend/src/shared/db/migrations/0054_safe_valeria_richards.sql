ALTER TABLE "email_suppressions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "signature_rect" jsonb;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_source_document_id_contract_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Fuzzy search inbox (căutare pe subiect care tolerează typo/parțial, nu doar match exact de
-- cuvinte întregi ca tsvector) — vezi inbound-service.ts::buildThreadConditions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "idx_email_threads_subject_trgm" ON "email_threads" USING gin ("subject" gin_trgm_ops);