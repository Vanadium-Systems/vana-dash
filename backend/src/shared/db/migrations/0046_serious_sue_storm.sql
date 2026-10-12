ALTER TABLE "billing_clients" ADD COLUMN "referral_discount_referral_id" text;--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "referral_discount_pending_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "billing_clients" ADD COLUMN "referral_discount_pending_currency" "billing_client_currency";