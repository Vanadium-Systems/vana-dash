CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"estimated_price" numeric(14, 2),
	"currency" text DEFAULT 'RON' NOT NULL,
	"link" text,
	"purchased" boolean DEFAULT false NOT NULL,
	"purchased_at" timestamp with time zone,
	"financial_record_id" uuid
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "severity" text DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_financial_record_id_financial_records_id_fk" FOREIGN KEY ("financial_record_id") REFERENCES "public"."financial_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_notes_pinned_updated" ON "notes" USING btree ("pinned","updated_at");--> statement-breakpoint
CREATE INDEX "ix_wishlist_category_purchased" ON "wishlist_items" USING btree ("category","purchased");