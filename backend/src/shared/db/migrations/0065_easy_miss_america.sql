CREATE TABLE "archive_folder_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"folder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text DEFAULT 'view' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text DEFAULT 'view' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_folders" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
-- Spații per om (PLAN.md C2): rădăcina lui Stefan se creează aici, sub ea intră toate
-- folderele care azi sunt la rădăcina arhivei, iar fișierele „la rădăcină" (folder_id null)
-- ajung în ea. Un singur DO block, fiindcă trei UPDATE-uri cu subselect-uri identice ar
-- depinde de ordinea de parcurgere a planului — imposibil de garantat.
DO $$
DECLARE
  stefan_id uuid;
  root_id uuid;
BEGIN
  SELECT "id" INTO stefan_id FROM "users" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1;
  IF stefan_id IS NULL THEN
    -- Fresh install: no users yet means no folders, files or events to hand over. (This
    -- raised an exception until 2026-10-12, which made an empty database impossible to migrate.)
    RETURN;
  END IF;

  INSERT INTO "archive_folders" ("name", "owner_user_id")
  VALUES ('Spațiul lui ' || COALESCE(NULLIF((SELECT "display_name" FROM "users" WHERE "id" = stefan_id), ''), (SELECT "email" FROM "users" WHERE "id" = stefan_id), 'Vanadium'), stefan_id)
  RETURNING "id" INTO root_id;

  -- parent_id IS NULL, dar rădăcina tocmai inserată se auto-exclude: altfel ea ar deveni
  -- propriul părinte (FK cu onDelete restrict acceptă asta, deci nu ar apărea nicio eroare).
  UPDATE "archive_folders" SET "parent_id" = root_id WHERE "parent_id" IS NULL AND "id" <> root_id;
  UPDATE "archive_folders" SET "owner_user_id" = stefan_id WHERE "owner_user_id" IS NULL;
  UPDATE "archive_files" SET "folder_id" = root_id WHERE "folder_id" IS NULL;
END $$;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
-- Calendar per om: tot ce e azi în calendar (inclusiv evenimentele din programările de pe
-- site, source='booking') e al lui Stefan.
UPDATE "calendar_events" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "deleted_at" IS NULL ORDER BY "created_at" ASC LIMIT 1)
WHERE "owner_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "archive_folders" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_files" ALTER COLUMN "folder_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_folder_shares" ADD CONSTRAINT "archive_folder_shares_folder_id_archive_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."archive_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_folder_shares" ADD CONSTRAINT "archive_folder_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_archive_folder_shares_folder_user" ON "archive_folder_shares" USING btree ("folder_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_archive_folder_shares_user" ON "archive_folder_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_event_attendees_event_user" ON "calendar_event_attendees" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_event_attendees_user" ON "calendar_event_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_shares_owner_user" ON "calendar_shares" USING btree ("owner_user_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_shares_user" ON "calendar_shares" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "archive_folders" ADD CONSTRAINT "archive_folders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_archive_folders_owner" ON "archive_folders" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_owner_start" ON "calendar_events" USING btree ("owner_user_id","start_at");--> statement-breakpoint
ALTER TABLE "archive_folders" ADD CONSTRAINT "archive_folders_not_own_parent" CHECK ("archive_folders"."parent_id" IS NULL OR "archive_folders"."parent_id" <> "archive_folders"."id");
