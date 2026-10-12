CREATE TABLE "asset_price_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_brokers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"broker" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"broker_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"limit_price" numeric(18, 4),
	"executed_price" numeric(18, 4),
	"status" text DEFAULT 'open' NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset_paper_orders" ADD CONSTRAINT "asset_paper_orders_broker_id_asset_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."asset_brokers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_price_providers_provider" ON "asset_price_providers" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_brokers_broker" ON "asset_brokers" USING btree ("broker");