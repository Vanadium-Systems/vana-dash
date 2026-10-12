ALTER TABLE "email_sends" ADD COLUMN "resend_email_id" text;--> statement-breakpoint
CREATE INDEX "idx_email_sends_resend_email_id" ON "email_sends" USING btree ("resend_email_id");