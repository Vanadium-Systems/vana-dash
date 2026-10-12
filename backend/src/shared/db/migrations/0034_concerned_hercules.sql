DROP INDEX "ix_plan_goals_scope_position";--> statement-breakpoint
ALTER TABLE "plan_goals" ADD COLUMN "tier" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_goals" ADD COLUMN "monthly_cost_ron" numeric(10, 2);--> statement-breakpoint
CREATE INDEX "ix_plan_goals_scope_tier_position" ON "plan_goals" USING btree ("scope","tier","position");