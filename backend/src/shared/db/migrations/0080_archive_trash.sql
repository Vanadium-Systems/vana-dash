CREATE TABLE "archive_trash_batches" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"root_type" text NOT NULL,
	"root_id" uuid NOT NULL,
	"original_parent_id" uuid NOT NULL,
	"deleted_by_user_id" uuid NOT NULL,
	"item_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "archive_trash_batches_root_type" CHECK ("archive_trash_batches"."root_type" IN ('file','folder'))
);
--> statement-breakpoint
CREATE TABLE "archive_stars" (
	"tenant_id" uuid DEFAULT COALESCE(NULLIF(current_setting('app.tenant_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "archive_stars_item_type" CHECK ("archive_stars"."item_type" IN ('file','folder'))
);
--> statement-breakpoint
ALTER TABLE "archive_folders" ADD COLUMN "color" smallint;--> statement-breakpoint
ALTER TABLE "archive_folders" ADD COLUMN "deleted_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "archive_files" ADD COLUMN "deleted_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "archive_trash_batches" ADD CONSTRAINT "archive_trash_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_trash_batches" ADD CONSTRAINT "archive_trash_batches_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_stars" ADD CONSTRAINT "archive_stars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_stars" ADD CONSTRAINT "archive_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_archive_trash_purge" ON "archive_trash_batches" USING btree ("purge_after") WHERE "archive_trash_batches"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_archive_stars" ON "archive_stars" USING btree ("tenant_id","user_id","item_type","item_id");--> statement-breakpoint
CREATE INDEX "idx_archive_folders_batch" ON "archive_folders" USING btree ("deleted_batch_id") WHERE "archive_folders"."deleted_batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_archive_files_batch" ON "archive_files" USING btree ("deleted_batch_id") WHERE "archive_files"."deleted_batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_archive_files_updated" ON "archive_files" USING btree ("updated_at" DESC NULLS LAST) WHERE "archive_files"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "archive_folders" ADD CONSTRAINT "archive_folders_color_range" CHECK ("archive_folders"."color" IS NULL OR "archive_folders"."color" BETWEEN 1 AND 8);--> statement-breakpoint
ALTER TABLE "archive_trash_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "archive_trash_batches" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
ALTER TABLE "archive_stars" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "archive_stars" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
--> statement-breakpoint
-- Rows soft-deleted before the Trash existed: one batch each, 30 days from now, so they show up in
-- the Trash and get purged later instead of staying in R2 forever (or being purged unseen today).
WITH files AS (
  UPDATE "archive_files" af SET "deleted_batch_id" = gen_random_uuid()
   WHERE af."deleted_at" IS NOT NULL AND af."deleted_batch_id" IS NULL
  RETURNING af."tenant_id", af."id", af."folder_id", af."size_bytes", af."deleted_at",
            COALESCE(af."updated_by_user_id", af."created_by_user_id") AS "by_user", af."deleted_batch_id"
)
INSERT INTO "archive_trash_batches" ("id", "tenant_id", "root_type", "root_id", "original_parent_id", "deleted_by_user_id", "item_count", "total_bytes", "purge_after", "created_at")
SELECT f."deleted_batch_id", f."tenant_id", 'file', f."id", f."folder_id",
       COALESCE(f."by_user", p."owner_user_id"), 1, f."size_bytes", now() + interval '30 days', f."deleted_at"
  FROM files f
  JOIN "archive_folders" p ON p."id" = f."folder_id";
--> statement-breakpoint
WITH folders AS (
  UPDATE "archive_folders" af SET "deleted_batch_id" = gen_random_uuid()
   WHERE af."deleted_at" IS NOT NULL AND af."deleted_batch_id" IS NULL AND af."parent_id" IS NOT NULL
  RETURNING af."tenant_id", af."id", af."parent_id", af."owner_user_id", af."deleted_at", af."deleted_batch_id"
)
INSERT INTO "archive_trash_batches" ("id", "tenant_id", "root_type", "root_id", "original_parent_id", "deleted_by_user_id", "item_count", "total_bytes", "purge_after", "created_at")
SELECT f."deleted_batch_id", f."tenant_id", 'folder', f."id", f."parent_id", f."owner_user_id", 1, 0, now() + interval '30 days', f."deleted_at"
  FROM folders f;
