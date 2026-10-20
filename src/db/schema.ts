import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  date,
  primaryKey,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// Money columns use doublePrecision. Amounts suffixed `_base` are converted to
// the base currency (BASE_CURRENCY, USD by default) at the rate locked for the
// event date. A store's sheet converts base amounts to its reporting currency
// with the same day's locked rates, so figures never drift with the market.

export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shopDomain: text("shop_domain").notNull().unique(), // xxx.myshopify.com
  currency: text("currency"), // Shopify store currency, filled in on first sync
  timezone: text("timezone"), // Shopify store time zone; orders fall on the day in this zone
  // Currency this store's sheet is reported in: the Google Ads account currency.
  reportingCurrency: text("reporting_currency").notNull().default("USD"),
  // "token": admin API access token (existing admin-created custom app)
  // "client_credentials": Dev Dashboard app, client ID + secret
  authType: text("auth_type").notNull().default("token"),
  accessTokenEnc: text("access_token_enc"),
  clientId: text("client_id"),
  clientSecretEnc: text("client_secret_enc"),
  // Fee rules, used when Shopify doesn't report the fee on a transaction
  paymentFeePct: doublePrecision("payment_fee_pct").notNull().default(0),
  paymentFeeFixed: doublePrecision("payment_fee_fixed").notNull().default(0),
  // Shopify's own transaction fee on gateways other than Shopify Payments
  platformFeePct: doublePrecision("platform_fee_pct").notNull().default(0),
  useReportedFees: boolean("use_reported_fees").notNull().default(true),
  // Media buyer / agency fee as a percentage of ad spend
  mediaBuyerFeePct: doublePrecision("media_buyer_fee_pct").notNull().default(0),
  active: boolean("active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // Shopify GID
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    orderDate: date("order_date").notNull(),
    currency: text("currency").notNull(), // shop currency
    cancelled: boolean("cancelled").notNull().default(false),
    totalPrice: doublePrecision("total_price").notNull(),
    totalTax: doublePrecision("total_tax").notNull(),
    // totalPrice minus tax, i.e. what the store keeps before costs
    netRevenue: doublePrecision("net_revenue").notNull(),
    reportedFees: doublePrecision("reported_fees"), // null when Shopify reports none
    gateways: text("gateways"),
    // Derived values, recomputed when costs or rates change
    fxRate: doublePrecision("fx_rate"), // 1 unit shop currency in base currency
    netRevenueBase: doublePrecision("net_revenue_base"),
    feesBase: doublePrecision("fees_base"),
    cogsBase: doublePrecision("cogs_base"),
    cogsMissing: boolean("cogs_missing").notNull().default(false),
    // "invoice" once an approved supplier invoice covers the order, else "estimate" (SKU costs)
    cogsSource: text("cogs_source").notNull().default("estimate"),
    feesSource: text("fees_source"), // "reported" | "rule"
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_date_idx").on(t.orderDate), index("orders_store_idx").on(t.storeId)],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(), // SKU, or product name when the line has no SKU
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitCostBase: doublePrecision("unit_cost_base"),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), index("order_lines_sku_idx").on(t.sku)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    refundDate: date("refund_date").notNull(),
    amount: doublePrecision("amount").notNull(), // incl. tax, shop currency
    amountNet: doublePrecision("amount_net").notNull(), // tax removed pro rata
    amountBase: doublePrecision("amount_base"),
    restockedQty: integer("restocked_qty").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refunds_date_idx").on(t.refundDate)],
);

export const refundLines = pgTable(
  "refund_lines",
  {
    id: serial("id").primaryKey(),
    refundId: text("refund_id").notNull().references(() => refunds.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: doublePrecision("subtotal").notNull(), // shop currency
    restockType: text("restock_type").notNull(),
  },
  (t) => [index("refund_lines_sku_idx").on(t.sku)],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date").notNull(),
    currency: text("currency").notNull(),
    // Units of `currency` per 1 unit of base currency. Written once per day and
    // never updated, which locks that day's conversions.
    rate: doublePrecision("rate").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.currency] })],
);

export const adSpend = pgTable(
  "ad_spend",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
    platform: text("platform").notNull().default("Google Ads"),
    account: text("account"),
    currency: text("currency").notNull(),
    amount: doublePrecision("amount").notNull(),
    amountBase: doublePrecision("amount_base"),
    note: text("note"),
    source: text("source").notNull().default("manual"), // manual | sheet (imported from a profit sheet)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_spend_date_idx").on(t.date)],
);

// Cost of goods per SKU. The row with the latest effective_from on or before
// an order's date applies to that order.
export const productCosts = pgTable(
  "product_costs",
  {
    id: serial("id").primaryKey(),
    sku: text("sku").notNull(),
    unitCost: doublePrecision("unit_cost").notNull(),
    currency: text("currency").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    source: text("source").notNull().default("manual"), // manual | supplier_sheet
    sourceRef: integer("source_ref"), // quote_imports.id
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_costs_sku_idx").on(t.sku, t.effectiveFrom)],
);

export const quoteImports = pgTable("quote_imports", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // upload
  filename: text("filename"),
  status: text("status").notNull().default("pending"), // processing | pending | done | failed
  summary: text("summary"),
  supplier: text("supplier"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteItems = pgTable("quote_items", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => quoteImports.id, { onDelete: "cascade" }),
  supplierRef: text("supplier_ref"), // the product as written by the supplier
  sku: text("sku"), // matched SKU in our catalogue, null if unmatched
  unitCost: doublePrecision("unit_cost").notNull(),
  currency: text("currency").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  previousCostBase: doublePrecision("previous_cost_base"),
  newCostBase: doublePrecision("new_cost_base"),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
});

// A supplier invoice, uploaded for one store. Each invoice_orders row is what
// the supplier billed for one of that store's orders; once approved it replaces
// the SKU-cost estimate as the order's cost of goods.
export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  supplier: text("supplier"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  filename: text("filename"),
  currency: text("currency"),
  total: doublePrecision("total"), // invoice total as stated, in `currency`
  storeOnInvoice: text("store_on_invoice"), // store name/URL as printed on the invoice
  summary: text("summary"),
  flags: jsonb("flags").$type<string[]>().notNull().default([]), // invoice-level problems
  status: text("status").notNull().default("processing"), // processing | pending | done | failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceOrders = pgTable(
  "invoice_orders",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
    orderRef: text("order_ref").notNull(), // the order number as the supplier wrote it
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }), // matched order in the invoice's store
    items: jsonb("items").$type<{ description: string; sku: string | null; quantity: number | null }[]>().notNull().default([]),
    productCost: doublePrecision("product_cost").notNull(),
    shippingCost: doublePrecision("shipping_cost").notNull().default(0),
    otherCost: doublePrecision("other_cost").notNull().default(0),
    currency: text("currency").notNull(),
    amountBase: doublePrecision("amount_base"), // total of the three, at the order date's rate
    estimatedCostBase: doublePrecision("estimated_cost_base"), // SKU-cost estimate when imported
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
  },
  (t) => [index("invoice_orders_order_idx").on(t.orderId), index("invoice_orders_invoice_idx").on(t.invoiceId)],
);

// Daily figures imported from a store's old profit sheet. They are kept for
// comparison with what Shopify reports, and the sheet's cost of goods stands in
// for days that no approved supplier invoice covers.
export const sheetDays = pgTable(
  "sheet_days",
  {
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    currency: text("currency").notNull(),
    revenue: doublePrecision("revenue"),
    cogs: doublePrecision("cogs"), // null when the sheet had no cost for the day
    cogsBase: doublePrecision("cogs_base"),
    adSpend: doublePrecision("ad_spend"),
    fees: doublePrecision("fees"),
    profit: doublePrecision("profit"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date] })],
);

// Costs of the business as a whole (salaries, software, services), not of one store.
// A monthly expense repeats on the same day of each month from `date` until `until`.
export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull(),
    monthly: boolean("monthly").notNull().default(false),
    until: date("until"), // last date a monthly expense applies, null = ongoing
    source: text("source").notNull().default("manual"), // manual | sheet
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expenses_date_idx").on(t.date)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
