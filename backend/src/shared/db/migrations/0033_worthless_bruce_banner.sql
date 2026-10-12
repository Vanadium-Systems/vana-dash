CREATE TABLE "plan_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"scope" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"threshold_type" text DEFAULT 'manual' NOT NULL,
	"threshold_value" numeric(14, 2),
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ix_plan_goals_scope_position" ON "plan_goals" USING btree ("scope","position");