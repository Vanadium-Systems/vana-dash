-- Parallel first visits to the Archive each created a space root for the same person, all with the
-- same name. Keep the oldest of those and move everything that hangs off the others into it.
-- Roots with another name stay: "Assign all their spaces" hands a person someone else's space on
-- purpose, and that root keeps its old owner's name.
CREATE TEMP VIEW "space_root_dupes" AS
SELECT f."id" AS "dupe_id", k."keep_id"
  FROM "archive_folders" f
  JOIN (
    SELECT DISTINCT ON ("tenant_id", "owner_user_id", "name") "tenant_id", "owner_user_id", "name", "id" AS "keep_id"
      FROM "archive_folders"
     WHERE "parent_id" IS NULL AND "deleted_at" IS NULL
     ORDER BY "tenant_id", "owner_user_id", "name", "created_at", "id"
  ) k ON k."tenant_id" = f."tenant_id" AND k."owner_user_id" = f."owner_user_id" AND k."name" = f."name"
 WHERE f."parent_id" IS NULL AND f."deleted_at" IS NULL AND f."id" <> k."keep_id";
--> statement-breakpoint
UPDATE "archive_folders" c SET "parent_id" = d."keep_id"
  FROM "space_root_dupes" d WHERE c."parent_id" = d."dupe_id";
--> statement-breakpoint
UPDATE "archive_files" af SET "folder_id" = d."keep_id"
  FROM "space_root_dupes" d WHERE af."folder_id" = d."dupe_id";
--> statement-breakpoint
UPDATE "archive_trash_batches" b SET "original_parent_id" = d."keep_id"
  FROM "space_root_dupes" d WHERE b."original_parent_id" = d."dupe_id";
--> statement-breakpoint
-- A share or a star that already exists on the kept root stays as it is; the duplicate goes with
-- the extra root (shares cascade, stars are deleted below).
UPDATE "archive_folder_shares" s SET "folder_id" = d."keep_id"
  FROM "space_root_dupes" d
 WHERE s."folder_id" = d."dupe_id"
   AND NOT EXISTS (SELECT 1 FROM "archive_folder_shares" k WHERE k."folder_id" = d."keep_id" AND k."user_id" = s."user_id");
--> statement-breakpoint
UPDATE "archive_stars" st SET "item_id" = d."keep_id"
  FROM "space_root_dupes" d
 WHERE st."item_type" = 'folder' AND st."item_id" = d."dupe_id"
   AND NOT EXISTS (
     SELECT 1 FROM "archive_stars" k
      WHERE k."item_type" = 'folder' AND k."item_id" = d."keep_id" AND k."user_id" = st."user_id" AND k."tenant_id" = st."tenant_id"
   );
--> statement-breakpoint
DELETE FROM "archive_stars" st USING "space_root_dupes" d WHERE st."item_type" = 'folder' AND st."item_id" = d."dupe_id";
--> statement-breakpoint
DELETE FROM "archive_folders" f USING "space_root_dupes" d WHERE f."id" = d."dupe_id";
--> statement-breakpoint
DROP VIEW "space_root_dupes";
