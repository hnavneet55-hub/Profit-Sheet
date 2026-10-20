import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BASE_CURRENCY } from "./config";
import { rateFromBase } from "./fx";
import { daysBetween } from "./dates";

export type DayRow = {
  date: string;
  gross: number; // order revenue excl. VAT, incl. shipping, after discounts
  refunds: number; // refunds issued that day (excl. VAT), whichever day the order was placed
  revenue: number;
  cogs: number;
  adSpend: number;
  mediaFee: number;
  fees: number;
  profit: number;
  orders: number;
  ordersMissingCogs: number;
  ordersInvoiced: number; // cost of goods from a supplier invoice, not the SKU estimate
};

export type Ratios = {
  roas: number | null;
  grossRoas: number | null;
  profitPct: number | null;
  cogsPct: number | null;
  poas: number | null;
};

export function ratios(r: Pick<DayRow, "gross" | "revenue" | "cogs" | "adSpend" | "profit">): Ratios {
  const div = (a: number, b: number) => (b ? a / b : null);
  // Matches the team's spreadsheet: % columns are relative to gross revenue.
  return {
    roas: div(r.revenue, r.adSpend),
    grossRoas: div(r.gross, r.adSpend),
    profitPct: div(r.profit, r.gross),
    cogsPct: div(r.cogs, r.gross),
    poas: div(r.profit, r.adSpend),
  };
}

const empty = (date: string): DayRow => ({
  date,
  gross: 0,
  refunds: 0,
  revenue: 0,
  cogs: 0,
  adSpend: 0,
  mediaFee: 0,
  fees: 0,
  profit: 0,
  orders: 0,
  ordersMissingCogs: 0,
  ordersInvoiced: 0,
});

export type Sheet = { currency: string; days: DayRow[]; total: DayRow };

/**
 * Daily profit sheet for one store (in its reporting currency) or all stores
 * (in the base currency). Each day converts with that day's locked rate.
 * `inBase` keeps a single store's sheet in the base currency, for comparing stores.
 */
export async function buildSheet(opts: { storeId?: number; from: string; to: string; inBase?: boolean }): Promise<Sheet> {
  const db = await getDb();
  const { storeId, from, to, inBase } = opts;
  const days = new Map(daysBetween(from, to).map((d) => [d, empty(d)]));

  const orderWhere = and(
    gte(schema.orders.orderDate, from),
    lte(schema.orders.orderDate, to),
    storeId ? eq(schema.orders.storeId, storeId) : undefined,
  );
  const orderRows = await db
    .select({
      date: schema.orders.orderDate,
      gross: sql<number>`coalesce(sum(${schema.orders.netRevenueBase}), 0)`,
      cogs: sql<number>`coalesce(sum(${schema.orders.cogsBase}), 0)`,
      fees: sql<number>`coalesce(sum(${schema.orders.feesBase}), 0)`,
      orders: sql<number>`count(*) filter (where not ${schema.orders.cancelled})`,
      missing: sql<number>`count(*) filter (where ${schema.orders.cogsMissing} and not ${schema.orders.cancelled})`,
      invoiced: sql<number>`count(*) filter (where ${schema.orders.cogsSource} = 'invoice' and not ${schema.orders.cancelled})`,
    })
    .from(schema.orders)
    .where(orderWhere)
    .groupBy(schema.orders.orderDate);
  for (const r of orderRows) {
    const d = days.get(r.date);
    if (!d) continue;
    d.gross = Number(r.gross);
    d.cogs = Number(r.cogs);
    d.fees = Number(r.fees);
    d.orders = Number(r.orders);
    d.ordersMissingCogs = Number(r.missing);
    d.ordersInvoiced = Number(r.invoiced);
  }

  const refundRows = await db
    .select({ date: schema.refunds.refundDate, amount: sql<number>`coalesce(sum(${schema.refunds.amountBase}), 0)` })
    .from(schema.refunds)
    .where(
      and(
        gte(schema.refunds.refundDate, from),
        lte(schema.refunds.refundDate, to),
        storeId ? eq(schema.refunds.storeId, storeId) : undefined,
      ),
    )
    .groupBy(schema.refunds.refundDate);
  for (const r of refundRows) {
    const d = days.get(r.date);
    if (d) d.refunds = Number(r.amount);
  }

  const adRows = await db
    .select({
      date: schema.adSpend.date,
      amount: sql<number>`coalesce(sum(${schema.adSpend.amountBase}), 0)`,
      fee: sql<number>`coalesce(sum(${schema.adSpend.amountBase} * coalesce(${schema.stores.mediaBuyerFeePct}, 0) / 100), 0)`,
    })
    .from(schema.adSpend)
    .leftJoin(schema.stores, eq(schema.adSpend.storeId, schema.stores.id))
    .where(
      and(
        gte(schema.adSpend.date, from),
        lte(schema.adSpend.date, to),
        storeId ? eq(schema.adSpend.storeId, storeId) : undefined,
      ),
    )
    .groupBy(schema.adSpend.date);
  for (const r of adRows) {
    const d = days.get(r.date);
    if (!d) continue;
    d.adSpend = Number(r.amount);
    d.mediaFee = Number(r.fee);
  }

  let currency = BASE_CURRENCY;
  if (storeId && !inBase) {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (store) currency = store.reportingCurrency;
  }

  const total = empty("total");
  const money = ["gross", "refunds", "cogs", "adSpend", "mediaFee", "fees"] as const;
  for (const d of days.values()) {
    if (currency !== BASE_CURRENCY && (d.gross || d.refunds || d.adSpend || d.cogs || d.fees)) {
      const k = await rateFromBase(currency, d.date);
      for (const f of money) d[f] *= k;
    }
    d.revenue = d.gross - d.refunds;
    d.profit = d.revenue - d.cogs - d.adSpend - d.mediaFee - d.fees;
    for (const f of [...money, "revenue", "profit", "orders", "ordersMissingCogs", "ordersInvoiced"] as const) total[f] += d[f];
  }
  return { currency, days: [...days.values()], total };
}
