-- Every company on the installation so far is Romanian. The defaults only fill the existing rows;
-- a new company takes its values from its country pack (backend/src/countries/).
ALTER TABLE "tenants" ADD COLUMN "country" text DEFAULT 'RO' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "time_zone" text DEFAULT 'Europe/Bucharest' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "currency" text DEFAULT 'RON' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "country" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "time_zone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "currency" DROP DEFAULT;
