ALTER TABLE "email_sends" ADD COLUMN "sent_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Cine a trimis, pe istoricul de trimiteri (email_sends): rândurile existente sunt ale lui Stefan.
UPDATE "email_sends" SET "sent_by_user_id" = (SELECT "id" FROM "users" WHERE "role_id" IS NOT NULL ORDER BY "created_at" LIMIT 1)
WHERE "sent_by_user_id" IS NULL;
