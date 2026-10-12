CREATE TYPE "public"."expense_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"description" text NOT NULL,
	"category" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"cycle" "expense_cycle" NOT NULL,
	"cycle_day" integer NOT NULL,
	"cycle_month" integer,
	"next_due_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
