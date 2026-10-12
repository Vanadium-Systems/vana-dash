ALTER TABLE "email_sends" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "last_clicked_url" text;