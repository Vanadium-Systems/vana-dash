ALTER TABLE "prospects" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prospects_assigned_user" ON "prospects" USING btree ("assigned_user_id");