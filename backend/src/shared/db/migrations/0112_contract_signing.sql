CREATE TABLE "contract_sign_events" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"document_sha256" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_sign_requests" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"contract_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"signer_role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"session_hash" text,
	"session_expires_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_document_id" uuid,
	"certificate_document_id" uuid,
	"download_until" timestamp with time zone,
	"decline_reason" text
);
--> statement-breakpoint
ALTER TABLE "contract_documents" DROP CONSTRAINT "contract_documents_saas_client";--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "signatures" jsonb;--> statement-breakpoint
ALTER TABLE "contract_sign_events" ADD CONSTRAINT "contract_sign_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_events" ADD CONSTRAINT "contract_sign_events_request_id_contract_sign_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."contract_sign_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_document_id_contract_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."contract_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_signed_document_id_contract_documents_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ADD CONSTRAINT "contract_sign_requests_certificate_document_id_contract_documents_id_fk" FOREIGN KEY ("certificate_document_id") REFERENCES "public"."contract_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contract_sign_events_request" ON "contract_sign_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contract_sign_requests_token" ON "contract_sign_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_contract_sign_requests_contract" ON "contract_sign_requests" USING btree ("contract_id");--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_saas_client" CHECK ("contract_documents"."doc_type" IN ('document', 'sign_certificate') OR "contract_documents"."billing_client_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "contract_sign_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_sign_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contract_sign_requests"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "contract_sign_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_sign_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Evidence: rows can be read and added, never changed or removed (no UPDATE / DELETE policy).
CREATE POLICY "tenant_isolation" ON "contract_sign_events" FOR SELECT
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation_insert" ON "contract_sign_events" FOR INSERT
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');