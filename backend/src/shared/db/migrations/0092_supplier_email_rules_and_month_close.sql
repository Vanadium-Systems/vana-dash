CREATE TABLE "supplier_email_rules" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"sender_pattern" text NOT NULL,
	"subject_contains" text,
	"attachment_name_pattern" text,
	"counterparty_name" text NOT NULL,
	"counterparty_cif" text,
	"counterparty_country" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"category" text,
	"reverse_charge_type" text DEFAULT 'none' NOT NULL,
	"reverse_charge_vat_rate" numeric(5, 2),
	"recurring_expense_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ck_supplier_email_rules_rc" CHECK ("supplier_email_rules"."reverse_charge_type" IN ('none','eu_services','non_eu_services'))
);
--> statement-breakpoint
CREATE TABLE "accounting_month_closures" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"period" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_user_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "email_message_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "email_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "archive_file_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "supplier_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_email_rules" ADD CONSTRAINT "supplier_email_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_email_rules" ADD CONSTRAINT "supplier_email_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_email_rules" ADD CONSTRAINT "supplier_email_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_email_rules" ADD CONSTRAINT "supplier_email_rules_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_month_closures" ADD CONSTRAINT "accounting_month_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_month_closures" ADD CONSTRAINT "accounting_month_closures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_month_closures" ADD CONSTRAINT "accounting_month_closures_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_month_closures" ADD CONSTRAINT "accounting_month_closures_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_email_attachment_id_email_attachments_id_fk" FOREIGN KEY ("email_attachment_id") REFERENCES "public"."email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_archive_file_id_archive_files_id_fk" FOREIGN KEY ("archive_file_id") REFERENCES "public"."archive_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_supplier_rule_id_supplier_email_rules_id_fk" FOREIGN KEY ("supplier_rule_id") REFERENCES "public"."supplier_email_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_email_rules_sender" ON "supplier_email_rules" USING btree ("tenant_id", lower("sender_pattern"), coalesce(lower("attachment_name_pattern"), '')) WHERE "supplier_email_rules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_supplier_email_rules_active" ON "supplier_email_rules" USING btree ("tenant_id", "active") WHERE "supplier_email_rules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounting_month_closures_period" ON "accounting_month_closures" USING btree ("tenant_id", "period") WHERE "accounting_month_closures"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_records_email_attachment" ON "financial_records" USING btree ("tenant_id", "email_attachment_id") WHERE "financial_records"."email_attachment_id" IS NOT NULL AND "financial_records"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "supplier_email_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "supplier_email_rules" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "accounting_month_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_month_closures" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
