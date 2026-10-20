CREATE TABLE "invoice_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"order_ref" text NOT NULL,
	"order_id" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_cost" double precision NOT NULL,
	"shipping_cost" double precision DEFAULT 0 NOT NULL,
	"other_cost" double precision DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"amount_base" double precision,
	"estimated_cost_base" double precision,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"supplier" text,
	"invoice_number" text,
	"invoice_date" date,
	"filename" text,
	"currency" text,
	"total" double precision,
	"store_on_invoice" text,
	"summary" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_imports" DROP CONSTRAINT "quote_imports_discord_message_id_unique";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cogs_source" text DEFAULT 'estimate' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_orders" ADD CONSTRAINT "invoice_orders_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_orders" ADD CONSTRAINT "invoice_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_orders_order_idx" ON "invoice_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoice_orders_invoice_idx" ON "invoice_orders" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "quote_imports" DROP COLUMN "discord_message_id";--> statement-breakpoint
ALTER TABLE "quote_imports" DROP COLUMN "discord_author";