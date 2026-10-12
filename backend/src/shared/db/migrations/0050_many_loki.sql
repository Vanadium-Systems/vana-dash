CREATE TABLE "assistant_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider" text NOT NULL,
	"api_key_enc" text,
	"base_url" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "assistant_providers_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"body_html" text NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "contract_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "metric_mappings" jsonb;--> statement-breakpoint
ALTER TABLE "platforms" ADD COLUMN "health_path" text;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD COLUMN "provider" text;