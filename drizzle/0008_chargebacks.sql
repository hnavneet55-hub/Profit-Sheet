ALTER TABLE "orders" ADD COLUMN "chargeback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "chargeback_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "inquiry" boolean DEFAULT false NOT NULL;