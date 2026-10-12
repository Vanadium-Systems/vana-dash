ALTER TABLE "bank_accounts" ALTER COLUMN "api_key_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "certificate_pem" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "private_key_enc" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "access_token_enc" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "auth_status" text DEFAULT 'unconfigured' NOT NULL;