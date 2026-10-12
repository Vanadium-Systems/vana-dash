CREATE TABLE "jeffbot_equity_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"equity" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jeffbot_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"summary" text NOT NULL,
	"markdown" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jeffbot_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" text DEFAULT 'current' NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jeffbot_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"source_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"strategy" text NOT NULL,
	"sub_account" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" numeric(24, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"fee_usdt" numeric(14, 4) NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jeffbot_equity_points_uniq" ON "jeffbot_equity_points" USING btree ("key","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "jeffbot_reviews_date_kind_uniq" ON "jeffbot_reviews" USING btree ("date","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "jeffbot_state_key_uniq" ON "jeffbot_state" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "jeffbot_trades_source_uniq" ON "jeffbot_trades" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "jeffbot_trades_ts_idx" ON "jeffbot_trades" USING btree ("ts");