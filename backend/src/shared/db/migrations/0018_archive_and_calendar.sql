CREATE TABLE "archive_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "archive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"folder_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"r2_key" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"recurrence_rule" text,
	"recurrence_end_at" timestamp with time zone,
	"color" text
);
--> statement-breakpoint
ALTER TABLE "archive_folders" ADD CONSTRAINT "archive_folders_parent_id_archive_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."archive_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_folder_id_archive_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."archive_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_archive_folders_parent" ON "archive_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_archive_files_r2_key" ON "archive_files" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "idx_archive_files_folder" ON "archive_files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_archive_files_tags" ON "archive_files" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_start" ON "calendar_events" USING btree ("start_at");