ALTER TABLE "recurring_expenses" ADD COLUMN "counterparty_name" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "counterparty_cif" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "counterparty_country" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "reverse_charge_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "reverse_charge_vat_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "auto_materialize" boolean DEFAULT true NOT NULL;