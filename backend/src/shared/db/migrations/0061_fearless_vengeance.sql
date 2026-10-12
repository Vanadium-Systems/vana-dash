DROP INDEX "jeffbot_trades_ts_idx";--> statement-breakpoint
DROP INDEX "jeffbot_equity_points_uniq";--> statement-breakpoint
ALTER TABLE "jeffbot_equity_points" ADD COLUMN "market" text DEFAULT 'crypto' NOT NULL;--> statement-breakpoint
ALTER TABLE "jeffbot_trades" ADD COLUMN "market" text DEFAULT 'crypto' NOT NULL;--> statement-breakpoint
CREATE INDEX "jeffbot_trades_market_ts_idx" ON "jeffbot_trades" USING btree ("market","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "jeffbot_equity_points_uniq" ON "jeffbot_equity_points" USING btree ("market","key","ts");--> statement-breakpoint
ALTER TABLE "jeffbot_equity_points" ADD CONSTRAINT "jeffbot_equity_points_market_check" CHECK ("jeffbot_equity_points"."market" IN ('crypto', 'stocks'));--> statement-breakpoint
ALTER TABLE "jeffbot_trades" ADD CONSTRAINT "jeffbot_trades_market_check" CHECK ("jeffbot_trades"."market" IN ('crypto', 'stocks'));