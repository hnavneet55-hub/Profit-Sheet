CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"monthly" boolean DEFAULT false NOT NULL,
	"until" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_days" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"revenue" double precision,
	"cogs" double precision,
	"cogs_base" double precision,
	"ad_spend" double precision,
	"fees" double precision,
	"profit" double precision,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_days_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sheet_days" ADD CONSTRAINT "sheet_days_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");