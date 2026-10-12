CREATE TABLE "scheduled_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"text" text,
	"prompt" text,
	"link_to" text,
	"recurrence" text DEFAULT 'once' NOT NULL,
	"weekday" integer,
	"conversation_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"token" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"exchange" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"api_secret_enc" text NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"exchange_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"limit_price" numeric(18, 4),
	"executed_price" numeric(18, 4),
	"status" text DEFAULT 'open' NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_paper_orders" ADD CONSTRAINT "crypto_paper_orders_exchange_id_crypto_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."crypto_exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_scheduled_runs_due" ON "scheduled_runs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_device_tokens_token" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_crypto_exchanges_exchange" ON "crypto_exchanges" USING btree ("exchange");