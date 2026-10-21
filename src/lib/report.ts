import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BASE_CURRENCY } from "./config";
import { rateFromBase } from "./fx";
import { daysBetween } from "./dates";
import { expensesByDay } from "./expenses";

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
  ordersInvoiced: number; // counted per order, cost of goods from a supplier invoice
  ordersDayWise: number; // on a day up to the end of the old profit sheet, costed per day not per order
  ordersSheetCogs: number; // of those, on a day the old sheet has a cost of goods for
  expenses: number; // business expenses (salaries, software…); all-stores view only
  clicks: number; // ad spend ÷ CPC, where a CPC was entered
  clickSpend: number; // the ad spend those clicks came from (for the CPC)
  clickOrders: number; // the orders of the days those clicks are from
};

export type Ratios = {
  roas: number | null;
  grossRoas: number | null;
  profitPct: number | null;
  cogsPct: number | null;
  poas: number | null;
  refundPct: number | null;
};

export function ratios(r: Pick<DayRow, "gross" | "refunds" | "revenue" | "cogs" | "adSpend" | "profit">): Ratios {
  const div = (a: number, b: number) => (b ? a / b : null);
  // Matches the team's spreadsheet: % columns are relative to gross revenue.
  return {
    roas: div(r.revenue, r.adSpend),
    grossRoas: div(r.gross, r.adSpend),
    profitPct: div(r.profit, r.gross),
    cogsPct: div(r.cogs, r.gross),
    poas: div(r.profit, r.adSpend),
    refundPct: div(r.refunds, r.gross),
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
  ordersDayWise: 0,
  ordersSheetCogs: 0,
  expenses: 0,
  clicks: 0,
  clickSpend: 0,
  clickOrders: 0,
});

/** Cost per click and conversion rate: the store's orders ÷ ad clicks (never Shopify's session-based rate). */
export function adStats(d: Pick<DayRow, "clicks" | "clickSpend" | "clickOrders">): { cpc: number | null; cvr: number | null } {
  return { cpc: d.clicks ? d.clickSpend / d.clicks : null, cvr: d.clicks ? d.clickOrders / d.clicks : null };
}

export type Sheet = { currency: string; days: DayRow[]; total: DayRow };

/**
 * Daily profit sheet for one store (in its reporting currency) or all stores
 * (in the base currency). Each day converts with that day's locked rate.
 * `inBase` keeps a single store's sheet in the base currency, for comparing stores.
 *
 * Cost of goods per store and day: up to the last day the old profit sheet has a
 * cost of goods for, the sheet's daily figure (that's how it was collected; days
 * it left blank fall back to the orders' own costs, unflagged). After that, the
 * orders' own costs: supplier invoices, else SKU-cost estimates.
 * Business expenses are only in the all-stores view, since they belong to no store.
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
      storeId: schema.orders.storeId,
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
    .groupBy(schema.orders.storeId, schema.orders.orderDate);
  const sheetCogs = new Map(
    (
      await db
        .select({ storeId: schema.sheetDays.storeId, date: schema.sheetDays.date, cogs: schema.sheetDays.cogsBase })
        .from(schema.sheetDays)
        .where(and(gte(schema.sheetDays.date, from), lte(schema.sheetDays.date, to), storeId ? eq(schema.sheetDays.storeId, storeId) : undefined))
    )
      .filter((r) => r.cogs != null)
      .map((r) => [`${r.storeId}|${r.date}`, r.cogs!]),
  );
  const dayWiseUntil = await sheetCogsUntil();
  const ordersByStoreDay = new Map<string, number>();
  for (const r of orderRows) {
    const d = days.get(r.date);
    if (!d) continue;
    const orders = Number(r.orders);
    ordersByStoreDay.set(`${r.storeId}|${r.date}`, orders);
    const until = dayWiseUntil.get(r.storeId);
    const dayWise = until != null && r.date <= until;
    const fromSheet = dayWise ? sheetCogs.get(`${r.storeId}|${r.date}`) : undefined;
    d.gross += Number(r.gross);
    d.cogs += fromSheet ?? Number(r.cogs);
    d.fees += Number(r.fees);
    d.orders += orders;
    d.ordersMissingCogs += dayWise ? 0 : Number(r.missing);
    d.ordersInvoiced += dayWise ? 0 : Number(r.invoiced);
    d.ordersDayWise += dayWise ? orders : 0;
    d.ordersSheetCogs += fromSheet != null ? orders : 0;
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
      storeId: schema.adSpend.storeId,
      date: schema.adSpend.date,
      amount: sql<number>`coalesce(sum(${schema.adSpend.amountBase}), 0)`,
      fee: sql<number>`coalesce(sum(${schema.adSpend.amountBase} * coalesce(${schema.stores.mediaBuyerFeePct}, 0) / 100), 0)`,
      clicks: sql<number>`coalesce(sum(${schema.adSpend.amount} / ${schema.adSpend.cpc}) filter (where ${schema.adSpend.cpc} > 0), 0)`,
      clickSpend: sql<number>`coalesce(sum(${schema.adSpend.amountBase}) filter (where ${schema.adSpend.cpc} > 0), 0)`,
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
    .groupBy(schema.adSpend.storeId, schema.adSpend.date);
  for (const r of adRows) {
    const d = days.get(r.date);
    if (!d) continue;
    d.adSpend += Number(r.amount);
    d.mediaFee += Number(r.fee);
    if (Number(r.clicks) > 0) {
      d.clicks += Number(r.clicks);
      d.clickSpend += Number(r.clickSpend);
      d.clickOrders += ordersByStoreDay.get(`${r.storeId}|${r.date}`) ?? 0;
    }
  }

  if (!storeId) {
    for (const [date, amount] of await expensesByDay(from, to)) {
      const d = days.get(date);
      if (d) d.expenses = amount;
    }
  }

  let currency = BASE_CURRENCY;
  if (storeId && !inBase) {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (store) currency = store.reportingCurrency;
  }

  const total = empty("total");
  const money = ["gross", "refunds", "cogs", "adSpend", "mediaFee", "fees", "clickSpend"] as const;
  for (const d of days.values()) {
    if (currency !== BASE_CURRENCY && (d.gross || d.refunds || d.adSpend || d.cogs || d.fees)) {
      const k = await rateFromBase(currency, d.date);
      for (const f of money) d[f] *= k;
    }
    d.revenue = d.gross - d.refunds;
    d.profit = d.revenue - d.cogs - d.adSpend - d.mediaFee - d.fees - d.expenses;
    for (const f of [...money, "expenses", "revenue", "profit", "orders", "ordersMissingCogs", "ordersInvoiced", "ordersDayWise", "ordersSheetCogs", "clicks", "clickOrders"] as const) total[f] += d[f];
  }
  return { currency, days: [...days.values()], total };
}

/** Per store, the last day the old profit sheet has a cost of goods for; days up to it are costed per day. */
export async function sheetCogsUntil(): Promise<Map<number, string>> {
  const db = await getDb();
  const rows = await db
    .select({ storeId: schema.sheetDays.storeId, until: sql<string>`max(${schema.sheetDays.date})::text` })
    .from(schema.sheetDays)
    .where(sql`${schema.sheetDays.cogs} is not null`)
    .groupBy(schema.sheetDays.storeId);
  return new Map(rows.map((r) => [r.storeId, r.until]));
}
