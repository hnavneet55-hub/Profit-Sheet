CREATE TABLE "ad_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"store_id" integer,
	"platform" text DEFAULT 'Google Ads' NOT NULL,
	"account" text,
	"currency" text NOT NULL,
	"amount" double precision NOT NULL,
	"amount_base" double precision,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"rate" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_date_currency_pk" PRIMARY KEY("date","currency")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_base" double precision
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"order_date" date NOT NULL,
	"currency" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"total_price" double precision NOT NULL,
	"total_tax" double precision NOT NULL,
	"net_revenue" double precision NOT NULL,
	"reported_fees" double precision,
	"gateways" text,
	"fx_rate" double precision,
	"net_revenue_base" double precision,
	"fees_base" double precision,
	"cogs_base" double precision,
	"cogs_missing" boolean DEFAULT false NOT NULL,
	"fees_source" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"unit_cost" double precision NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"filename" text,
	"discord_message_id" text,
	"discord_author" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text,
	"supplier" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_imports_discord_message_id_unique" UNIQUE("discord_message_id")
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"supplier_ref" text,
	"sku" text,
	"unit_cost" double precision NOT NULL,
	"currency" text NOT NULL,
	"effective_from" date NOT NULL,
	"previous_cost_base" double precision,
	"new_cost_base" double precision,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"refund_id" text NOT NULL,
	"order_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" double precision NOT NULL,
	"restock_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"refund_date" date NOT NULL,
	"amount" double precision NOT NULL,
	"amount_net" double precision NOT NULL,
	"amount_base" double precision,
	"restocked_qty" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shop_domain" text NOT NULL,
	"currency" text,
	"reporting_currency" text DEFAULT 'USD' NOT NULL,
	"auth_type" text DEFAULT 'token' NOT NULL,
	"access_token_enc" text,
	"client_id" text,
	"client_secret_enc" text,
	"payment_fee_pct" double precision DEFAULT 0 NOT NULL,
	"payment_fee_fixed" double precision DEFAULT 0 NOT NULL,
	"platform_fee_pct" double precision DEFAULT 0 NOT NULL,
	"use_reported_fees" boolean DEFAULT true NOT NULL,
	"media_buyer_fee_pct" double precision DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_import_id_quote_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."quote_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_date_idx" ON "ad_spend" USING btree ("date");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_sku_idx" ON "order_lines" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "orders_date_idx" ON "orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "orders_store_idx" ON "orders" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "product_costs_sku_idx" ON "product_costs" USING btree ("sku","effective_from");--> statement-breakpoint
CREATE INDEX "refund_lines_sku_idx" ON "refund_lines" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "refunds_date_idx" ON "refunds" USING btree ("refund_date");