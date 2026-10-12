DROP INDEX "ix_wishlist_category_purchased";--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD COLUMN "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_wishlist_scope_category_purchased" ON "wishlist_items" USING btree ("scope","category","purchased");