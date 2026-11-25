-- LiveKit only reports who is in a room now, so a call keeps its own stats while it runs.
ALTER TABLE "calls" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "last_active_at" timestamp with time zone;