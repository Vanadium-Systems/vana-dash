ALTER TABLE "email_messages" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "inbound_source" text DEFAULT 'resend' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_messages_source_message_id" ON "email_messages" USING btree ("source_message_id") WHERE "email_messages"."inbound_source" = 'cloudflare';