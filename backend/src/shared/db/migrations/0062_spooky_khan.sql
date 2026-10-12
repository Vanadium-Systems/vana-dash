CREATE TABLE "booking_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"calendar_event_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"name" text,
	"email" text,
	"company" text,
	"topic" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"cancel_token_hash" text,
	"personal_data_purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_booking_blocks_range" ON "booking_blocks" USING btree ("start_at","end_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bookings_confirmed_start" ON "bookings" USING btree ("start_at") WHERE status = 'confirmed' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bookings_cancel_token" ON "bookings" USING btree ("cancel_token_hash");--> statement-breakpoint
CREATE INDEX "idx_bookings_end" ON "bookings" USING btree ("end_at");