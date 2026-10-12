ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'ro' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_currency" text DEFAULT 'RON' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_locale" CHECK ("users"."locale" IN ('ro', 'en'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_display_currency" CHECK ("users"."display_currency" IN ('RON', 'EUR', 'USD'));