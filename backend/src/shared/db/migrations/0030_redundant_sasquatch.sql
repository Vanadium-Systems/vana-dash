ALTER TABLE "email_messages" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD COLUMN "content_id" text;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD COLUMN "disposition" text;