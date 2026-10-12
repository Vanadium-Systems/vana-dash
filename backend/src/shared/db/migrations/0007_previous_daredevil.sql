CREATE TABLE "email_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "email_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"match_type" text NOT NULL,
	"match_value" text NOT NULL,
	"action" text NOT NULL,
	"label_id" uuid
);
--> statement-breakpoint
CREATE TABLE "email_blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"from_key" text NOT NULL,
	"to" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"template_id" uuid,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "is_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "is_starred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "folder" text DEFAULT 'inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "label_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "forward_of_message_id" uuid;--> statement-breakpoint
ALTER TABLE "email_rules" ADD CONSTRAINT "email_rules_label_id_email_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."email_labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_labels_name" ON "email_labels" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_blocklist_address" ON "email_blocklist" USING btree ("address");--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_label_id_email_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."email_labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_forward_of_message_id_email_messages_id_fk" FOREIGN KEY ("forward_of_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_messages_folder" ON "email_messages" USING btree ("folder");--> statement-breakpoint
CREATE INDEX "idx_email_messages_label" ON "email_messages" USING btree ("label_id");--> statement-breakpoint
-- Index funcțional (nu coloană generată — mai simplu, fără edge-case-uri de migrare Drizzle pe
-- tsvector) pt. căutare full-text. Query-urile de search trebuie să folosească EXACT aceeași
-- expresie ca să beneficieze de index (vezi modules/email/service.ts).
CREATE INDEX "idx_email_messages_search" ON "email_messages" USING gin (to_tsvector('simple', coalesce("subject", '') || ' ' || coalesce("body_text", '')));