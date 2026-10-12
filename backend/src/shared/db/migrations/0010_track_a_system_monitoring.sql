CREATE TABLE "system_alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_key" text NOT NULL,
	"current_level" text DEFAULT 'green' NOT NULL,
	"last_transition_at" timestamp with time zone,
	"last_email_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_alert_state_signal_key_unique" UNIQUE("signal_key")
);
--> statement-breakpoint
CREATE TABLE "system_metrics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	"cpu_pct" real NOT NULL,
	"ram_pct" real NOT NULL,
	"disk_pct" real NOT NULL,
	"containers_healthy" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_system_metrics_snapshots_captured_at" ON "system_metrics_snapshots" USING btree ("captured_at");