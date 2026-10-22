CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"room_name" text NOT NULL,
	"room_url" text NOT NULL,
	"public_id" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"booking_id" uuid,
	"prospect_id" uuid,
	"billing_client_id" uuid,
	"duration_seconds" integer,
	"participant_count" integer,
	"room_deleted_at" timestamp with time zone,
	CONSTRAINT "calls_room_name_unique" UNIQUE("room_name"),
	CONSTRAINT "calls_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_billing_client_id_billing_clients_id_fk" FOREIGN KEY ("billing_client_id") REFERENCES "public"."billing_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_calls_created" ON "calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_calls_status_expires" ON "calls" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calls_booking" ON "calls" USING btree ("booking_id") WHERE booking_id IS NOT NULL;