CREATE TABLE "spv_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"anaf_message_id" text NOT NULL,
	"type" text NOT NULL,
	"detail" text NOT NULL,
	"cif" text NOT NULL,
	"anaf_created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_spv_messages_anaf_message_id" ON "spv_messages" USING btree ("anaf_message_id");