-- Refuses to build the index over duplicates: the data health tab merges them first.
-- The message carries counts only, no CIF values.
DO $$
DECLARE groups integer; surplus integer;
BEGIN
  SELECT count(*), coalesce(sum(n - 1), 0) INTO groups, surplus FROM (
    SELECT count(*) AS n FROM "prospects"
     WHERE "cif_normalized" <> '' AND "deleted_at" IS NULL AND "merged_into_id" IS NULL
     GROUP BY "tenant_id", "cif_normalized" HAVING count(*) > 1
  ) c;
  IF groups > 0 THEN
    RAISE EXCEPTION 'prospects: % groups of live prospects share a normalized CIF (% surplus rows); merge them in the data health tab, then run the migration again', groups, surplus;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prospects_cif_normalized" ON "prospects" USING btree ("tenant_id","cif_normalized") WHERE "prospects"."cif_normalized" <> '' AND "prospects"."deleted_at" IS NULL AND "prospects"."merged_into_id" IS NULL;
