CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "user_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"identity_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_thread_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_message_id" uuid,
	"muted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"name" text,
	"dm_key" text,
	"created_by_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"message_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"thumbnail_path" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"conversation_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"client_id" uuid NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_prefs" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nav_layout" jsonb;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_records" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "sent_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "archive_files" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "archive_files" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_goals" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_addenda" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_addenda" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mailboxes" ADD CONSTRAINT "user_mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_reads" ADD CONSTRAINT "email_thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread_reads" ADD CONSTRAINT "email_thread_reads_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_name" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_mailboxes_user_identity" ON "user_mailboxes" USING btree ("user_id","identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_tokens_hash" ON "user_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_user_tokens_user_kind" ON "user_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_assistant_usage_user_month" ON "assistant_usage" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "ix_assistant_usage_month" ON "assistant_usage" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_thread_reads_user_thread" ON "email_thread_reads" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_members_user" ON "conversation_members" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversations_dm_key" ON "conversations" USING btree ("dm_key") WHERE "conversations"."kind" = 'dm';--> statement-breakpoint
CREATE INDEX "idx_message_attachments_message" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_attachments_unattached" ON "message_attachments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_messages_client_id" ON "messages" USING btree ("conversation_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_created" ON "messages" USING btree ("conversation_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "ix_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_audit_log_actor" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD CONSTRAINT "billing_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD CONSTRAINT "billing_clients_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_goals" ADD CONSTRAINT "plan_goals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_addenda" ADD CONSTRAINT "contract_addenda_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_addenda" ADD CONSTRAINT "contract_addenda_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_users_role" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_email_messages_sent_by" ON "email_messages" USING btree ("sent_by_user_id");--> statement-breakpoint
-- ─── Date (nu generat de drizzle-kit) ────────────────────────────────────────────────────────
-- În Etapa 1 există un singur om (Stefan), deci tot ce e deja în DB îi aparține. Coloanele
-- rămân nullable cu backfill, nu NOT NULL: NOT NULL se pune în migrarea de după Wave 2,
-- când fiecare cale de scriere trece prin contextul requestului.
INSERT INTO "roles" ("name", "kind", "features") VALUES ('Admin', 'admin', '{}'), ('Manager', 'manager', '{}')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- Rolul Admin nu are listă de funcționalități (primește tot ce are firma); Manager pornește gol.
UPDATE "users" SET
  "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'Admin' LIMIT 1),
  "is_platform_admin" = true,
  "status" = 'active'
WHERE "role_id" IS NULL;
--> statement-breakpoint
-- Cutii de email: adminul are toate implicit, deci Stefan nu primește rânduri în user_mailboxes.
UPDATE "notes" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "plan_goals" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "wishlist_items" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "assistant_conversations" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "scheduled_runs" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "email_drafts" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "push_subscriptions" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "device_tokens" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "financial_records" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "billing_clients" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "contract_documents" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "contract_addenda" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "prospects" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "calendar_events" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "archive_files" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "payment_matches" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
UPDATE "alert_rules" SET "created_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "updated_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1) WHERE "created_by_user_id" IS NULL;--> statement-breakpoint
-- Cine a trimis: toate mesajele iesite de azi au fost trimise de Stefan.
UPDATE "email_messages" SET "sent_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1)
WHERE "direction" = 'out' AND "sent_by_user_id" IS NULL;
--> statement-breakpoint
-- Citit/necitit per om (C2): `last_read_at` = momentul ultimului mesaj primit citit din fir.
-- Un fir fără niciun mesaj citit nu primește rând → totul necitit, care e starea de azi.
-- Verificarea „numărul de necitite identic înainte și după" se face pe dump de prod (DB-5).
WITH "per_thread" AS (
  SELECT "thread_id", max("received_at") FILTER (WHERE "is_read") AS "last_read_at"
  FROM "email_messages"
  WHERE "direction" = 'in' AND "deleted_at" IS NULL AND "received_at" IS NOT NULL
  GROUP BY "thread_id"
)
INSERT INTO "email_thread_reads" ("user_id", "thread_id", "last_read_at")
SELECT (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1), "thread_id", "last_read_at"
FROM "per_thread"
WHERE "last_read_at" IS NOT NULL
ON CONFLICT ("user_id", "thread_id") DO NOTHING;
--> statement-breakpoint
-- Nav-ul mutat de pe dashboard_config pe user. Rândul din dashboard_config rămâne până în
-- Wave 2 (BE-2), când serviciul citește de aici; atunci se șterge cu o migrare separată.
UPDATE "users" SET "nav_layout" = (
  SELECT "value" FROM "dashboard_config" WHERE "key" = 'nav.layout' LIMIT 1
) WHERE "nav_layout" IS NULL AND EXISTS (SELECT 1 FROM "dashboard_config" WHERE "key" = 'nav.layout');
