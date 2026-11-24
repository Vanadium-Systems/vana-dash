CREATE TABLE "contract_numbers" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"series_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"contract_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "contract_series" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"number_format" text DEFAULT '{code}-{n:3}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"counterparty_kind" text NOT NULL,
	"billing_client_id" uuid,
	"prospect_id" uuid,
	"user_id" uuid,
	"counterparty_name" text NOT NULL,
	"series_id" uuid,
	"number" integer,
	"external_number" text,
	"signed_on" date,
	"starts_on" date,
	"ends_on" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_months" integer,
	"notice_days" integer,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text NOT NULL,
	"template_id" uuid,
	"template_snapshot" jsonb,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notice_event_id" uuid,
	"notice_alerted_for" date,
	CONSTRAINT "contracts_renewal_months" CHECK (NOT "contracts"."auto_renew" OR "contracts"."renewal_months" > 0),
	CONSTRAINT "contracts_notice_needs_end" CHECK ("contracts"."notice_days" IS NULL OR "contracts"."ends_on" IS NOT NULL)
);
--> statement-breakpoint
DROP INDEX "uq_contract_templates_tenant_key";--> statement-breakpoint
ALTER TABLE "contract_documents" ALTER COLUMN "billing_client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_templates" ALTER COLUMN "key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "signer_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_numbers" ADD CONSTRAINT "contract_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_numbers" ADD CONSTRAINT "contract_numbers_series_id_contract_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."contract_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_numbers" ADD CONSTRAINT "contract_numbers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_series" ADD CONSTRAINT "contract_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_series_id_contract_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."contract_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contract_numbers_tenant_series_number" ON "contract_numbers" USING btree ("tenant_id","series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contract_series_tenant_code" ON "contract_series" USING btree ("tenant_id","code") WHERE "contract_series"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contracts_tenant_ends_on" ON "contracts" USING btree ("tenant_id","ends_on") WHERE "contracts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contracts_billing_client" ON "contracts" USING btree ("billing_client_id");--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contract_documents_contract" ON "contract_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contract_templates_tenant_key" ON "contract_templates" USING btree ("tenant_id","key") WHERE "contract_templates"."key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_saas_client" CHECK ("contract_documents"."doc_type" = 'document' OR "contract_documents"."billing_client_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "contract_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contract_series"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contracts"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "contract_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_numbers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contract_numbers"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Backfill. Every statement only adds what is missing, so running it twice changes nothing.
-- One series per company that already has contract data: the numbering so far (001, 002...) was one sequence for every kind of contract.
INSERT INTO "contract_series" ("tenant_id", "code", "name", "number_format")
SELECT t."id", 'C', 'Contracte', '{n:3}' FROM "tenants" t
 WHERE (EXISTS (SELECT 1 FROM "billing_clients" c WHERE c."tenant_id" = t."id" AND c."contract_details"->>'nrContract' IS NOT NULL)
        OR EXISTS (SELECT 1 FROM "contract_documents" d WHERE d."tenant_id" = t."id")
        OR EXISTS (SELECT 1 FROM "dashboard_config" k WHERE k."tenant_id" = t."id" AND k."key" = 'contract.reservedNumbers'))
   AND NOT EXISTS (SELECT 1 FROM "contract_series" s WHERE s."tenant_id" = t."id" AND s."deleted_at" IS NULL);--> statement-breakpoint
-- One SaaS contract per client with a document, or a contract number and not a demo. A client that is deleted or being deleted is a
-- former client: its contract stays as history, terminated.
INSERT INTO "contracts" ("tenant_id", "title", "category", "counterparty_kind", "billing_client_id", "counterparty_name", "series_id",
                         "external_number", "signed_on", "owner_user_id", "status", "origin")
SELECT c."tenant_id", 'Contract SaaS', 'saas', 'client', c."id", c."name",
       (SELECT s."id" FROM "contract_series" s WHERE s."tenant_id" = c."tenant_id" AND s."deleted_at" IS NULL ORDER BY s."created_at" LIMIT 1),
       NULLIF(trim(c."contract_details"->>'nrContract'), ''),
       (SELECT min(d."signed_at")::date FROM "contract_documents" d WHERE d."billing_client_id" = c."id" AND d."doc_type" = 'contract' AND d."is_signed" AND d."deleted_at" IS NULL),
       (SELECT u."id" FROM "users" u LEFT JOIN "roles" r ON r."id" = u."role_id"
         WHERE u."tenant_id" = c."tenant_id" AND u."deleted_at" IS NULL
         ORDER BY u."is_platform_admin" DESC, (r."kind" = 'admin') DESC NULLS LAST, u."created_at" LIMIT 1),
       CASE
         WHEN c."deleted_at" IS NOT NULL OR c."pending_deletion_at" IS NOT NULL THEN 'terminated'
         WHEN EXISTS (SELECT 1 FROM "contract_documents" d WHERE d."billing_client_id" = c."id" AND d."doc_type" = 'contract' AND d."is_signed" AND d."deleted_at" IS NULL) THEN 'signed'
         ELSE 'draft'
       END,
       'saas'
  FROM "billing_clients" c
 WHERE (EXISTS (SELECT 1 FROM "contract_documents" d WHERE d."billing_client_id" = c."id")
        OR (NOT c."is_demo" AND NULLIF(trim(c."contract_details"->>'nrContract'), '') IS NOT NULL))
   AND NOT EXISTS (SELECT 1 FROM "contracts" k WHERE k."billing_client_id" = c."id" AND k."origin" = 'saas');--> statement-breakpoint
-- A live contract with a plain number takes it in the series. A former client keeps it only as text: when the same number was given
-- again, the live contract or the reservation wins. Ties between live contracts go to the oldest client.
INSERT INTO "contract_numbers" ("tenant_id", "series_id", "number", "kind", "contract_id")
SELECT DISTINCT ON (k."tenant_id", k."series_id", k."external_number"::int)
       k."tenant_id", k."series_id", k."external_number"::int, 'used', k."id"
  FROM "contracts" k JOIN "billing_clients" c ON c."id" = k."billing_client_id"
 WHERE k."origin" = 'saas' AND k."status" <> 'terminated' AND k."external_number" ~ '^[0-9]{1,6}$' AND k."series_id" IS NOT NULL
 ORDER BY k."tenant_id", k."series_id", k."external_number"::int, c."created_at"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "contracts" k SET "number" = n."number", "external_number" = NULL
  FROM "contract_numbers" n
 WHERE n."contract_id" = k."id" AND k."number" IS NULL;--> statement-breakpoint
-- The numbers reserved for contracts made outside the app (they were a JSON list in dashboard_config).
INSERT INTO "contract_numbers" ("tenant_id", "series_id", "number", "kind", "note")
SELECT k."tenant_id", s."id", (r->>'number')::int, 'reserved', concat_ws(' · ', r->>'note', r->>'date')
  FROM "dashboard_config" k
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(k."value") = 'array' THEN k."value" ELSE '[]'::jsonb END) r
  JOIN LATERAL (SELECT s."id" FROM "contract_series" s WHERE s."tenant_id" = k."tenant_id" AND s."deleted_at" IS NULL ORDER BY s."created_at" LIMIT 1) s ON true
 WHERE k."key" = 'contract.reservedNumbers' AND (r->>'number') ~ '^[0-9]{1,6}$'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "contract_documents" d SET "contract_id" = k."id"
  FROM "contracts" k
 WHERE d."contract_id" IS NULL AND k."billing_client_id" = d."billing_client_id" AND k."origin" = 'saas';--> statement-breakpoint
UPDATE "contract_templates" SET "is_system" = true, "category" = 'saas' WHERE "key" IS NOT NULL AND NOT "is_system";--> statement-breakpoint
ALTER TABLE "contract_documents" ALTER COLUMN "contract_id" SET NOT NULL;