CREATE TABLE "outreach_mailboxes" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"address" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_secure" boolean DEFAULT true NOT NULL,
	"imap_host" text,
	"imap_port" integer,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"auth_kind" text DEFAULT 'password' NOT NULL,
	"secret_enc" text NOT NULL,
	"daily_cap" integer DEFAULT 30 NOT NULL,
	"warmup_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error_code" text,
	"last_sent_at" timestamp with time zone,
	"last_tested_at" timestamp with time zone,
	"last_imap_check_at" timestamp with time zone,
	CONSTRAINT "ck_outreach_mailboxes_auth_kind" CHECK ("outreach_mailboxes"."auth_kind" IN ('password', 'oauth2')),
	CONSTRAINT "ck_outreach_mailboxes_status" CHECK ("outreach_mailboxes"."status" IN ('active', 'paused', 'error')),
	CONSTRAINT "ck_outreach_mailboxes_daily_cap" CHECK ("outreach_mailboxes"."daily_cap" >= 1)
);
--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "outreach_mailbox_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_mailboxes" ADD CONSTRAINT "outreach_mailboxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outreach_mailboxes_tenant_address" ON "outreach_mailboxes" USING btree ("tenant_id",lower("address")) WHERE "outreach_mailboxes"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_outreach_mailbox_id_outreach_mailboxes_id_fk" FOREIGN KEY ("outreach_mailbox_id") REFERENCES "public"."outreach_mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_sends_outreach_mailbox" ON "email_sends" USING btree ("outreach_mailbox_id","created_at") WHERE "email_sends"."outreach_mailbox_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "outreach_mailboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outreach_mailboxes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outreach_mailboxes" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
