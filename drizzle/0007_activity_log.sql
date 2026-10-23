CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"area" text NOT NULL,
	"summary" text NOT NULL,
	"store_id" integer,
	"store_name" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE INDEX "activity_log_day_idx" ON "activity_log" USING btree ("day","at");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "activity_log_area_idx" ON "activity_log" USING btree ("area");--> statement-breakpoint
CREATE INDEX "activity_log_store_idx" ON "activity_log" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "activity_log_source_idx" ON "activity_log" USING btree ("source");