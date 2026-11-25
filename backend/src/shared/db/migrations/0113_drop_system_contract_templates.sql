-- The SaaS contract, price annex and addendum stop being built-in templates: the company now keeps
-- them as its own templates, like any other. The built-in rows, the commercial terms and clause
-- variants that only they used, and the per-client addendum table go.
UPDATE "contracts" SET "template_id" = NULL WHERE "template_id" IN (SELECT "id" FROM "contract_templates" WHERE "is_system");--> statement-breakpoint
DELETE FROM "contract_templates" WHERE "is_system";--> statement-breakpoint
DELETE FROM "dashboard_config" WHERE "key" IN ('contract.terms', 'contract.fragments');--> statement-breakpoint
ALTER TABLE "contract_documents" DROP CONSTRAINT IF EXISTS "contract_documents_addendum_id_contract_addenda_id_fk";--> statement-breakpoint
ALTER TABLE "contract_addenda" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "contract_addenda" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_contract_documents_client_type";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_contract_templates_tenant_key";--> statement-breakpoint
ALTER TABLE "contract_documents" DROP COLUMN "addendum_id";--> statement-breakpoint
ALTER TABLE "contract_templates" DROP COLUMN "key";--> statement-breakpoint
ALTER TABLE "contract_templates" DROP COLUMN "placeholders";--> statement-breakpoint
ALTER TABLE "contract_templates" DROP COLUMN "is_system";
