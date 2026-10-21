CREATE TABLE "ads_reports" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"account" text,
	"cost" double precision NOT NULL,
	"clicks" double precision NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_reports_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
ALTER TABLE "ads_reports" ADD CONSTRAINT "ads_reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;