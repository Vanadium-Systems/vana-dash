ALTER TABLE "users" ADD COLUMN "home_layout" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sound_on" boolean DEFAULT false NOT NULL;