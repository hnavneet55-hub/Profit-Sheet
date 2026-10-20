import "server-only";
import { asc, eq, inArray, desc, and, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { rateToBase, toBase } from "./fx";

type CostRow = typeof schema.productCosts.$inferSelect;

/** Loads cost history for the given SKUs (all SKUs if omitted), oldest first. */
export async function loadCostIndex(skus?: string[]): Promise<Map<string, CostRow[]>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.productCosts)
    .where(skus ? inArray(schema.productCosts.sku, skus.length ? skus : [""]) : undefined)
    .orderBy(asc(schema.productCosts.effectiveFrom), asc(schema.productCosts.id));
  const index = new Map<string, CostRow[]>();
  for (const r of rows) {
    const list = index.get(r.sku) ?? [];
    list.push(r);
    index.set(r.sku, list);
  }
  return index;
}

/** The cost in effect on `date`: the latest row starting on or before it. */
export function costOn(index: Map<string, CostRow[]>, sku: string, date: string): CostRow | undefined {
  const list = index.get(sku);
  if (!list) return undefined;
  let found: CostRow | undefined;
  for (const r of list) if (r.effectiveFrom <= date) found = r;
  return found;
}

export async function currentCostBase(sku: string, date: string): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.productCosts)
    .where(and(eq(schema.productCosts.sku, sku), lte(schema.productCosts.effectiveFrom, date)))
    .orderBy(desc(schema.productCosts.effectiveFrom), desc(schema.productCosts.id))
    .limit(1);
  return row ? toBase(row.unitCost, row.currency, date) : null;
}

/**
 * Recomputes the base-currency figures (revenue, fees, COGS, refunds) for the
 * given orders. Call after a sync, a cost change, or a fee-rule change.
 */
export async function recomputeOrders(orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  const db = await getDb();
  for (let i = 0; i < orderIds.length; i += 200) {
    const ids = orderIds.slice(i, i + 200);
    const orders = await db
      .select({ order: schema.orders, store: schema.stores })
      .from(schema.orders)
      .innerJoin(schema.stores, eq(schema.orders.storeId, schema.stores.id))
      .where(inArray(schema.orders.id, ids));
    const lines = await db.select().from(schema.orderLines).where(inArray(schema.orderLines.orderId, ids));
    const refunds = await db.select().from(schema.refunds).where(inArray(schema.refunds.orderId, ids));
    const index = await loadCostIndex([...new Set(lines.map((l) => l.sku))]);
    const invoiced = await db
      .select()
      .from(schema.invoiceOrders)
      .where(and(inArray(schema.invoiceOrders.orderId, ids), eq(schema.invoiceOrders.status, "approved")));

    for (const { order, store } of orders) {
      const fx = await rateToBase(order.currency, order.orderDate);

      let fees: number;
      let feesSource: string;
      const usesShopifyPayments = (order.gateways ?? "").includes("shopify_payments");
      const platformFee = usesShopifyPayments ? 0 : (order.totalPrice * store.platformFeePct) / 100;
      if (store.useReportedFees && order.reportedFees != null) {
        fees = order.reportedFees + platformFee;
        feesSource = "reported";
      } else {
        fees = order.totalPrice > 0 ? (order.totalPrice * store.paymentFeePct) / 100 + store.paymentFeeFixed + platformFee : 0;
        feesSource = "rule";
      }

      let cogs = 0;
      let missing = false;
      for (const line of lines.filter((l) => l.orderId === order.id)) {
        const cost = costOn(index, line.sku, order.orderDate);
        let unitBase: number | null = null;
        if (cost) unitBase = await toBase(cost.unitCost, cost.currency, order.orderDate);
        else missing = true;
        cogs += (unitBase ?? 0) * line.quantity;
        await db.update(schema.orderLines).set({ unitCostBase: unitBase }).where(eq(schema.orderLines.id, line.id));
      }

      // What the supplier actually billed replaces the SKU-cost estimate.
      const billed = invoiced.filter((i) => i.orderId === order.id);
      let cogsSource = "estimate";
      if (billed.length) {
        cogs = 0;
        for (const b of billed) cogs += await toBase(b.productCost + b.shippingCost + b.otherCost, b.currency, order.orderDate);
        missing = false;
        cogsSource = "invoice";
      }

      await db
        .update(schema.orders)
        .set({
          fxRate: fx,
          netRevenueBase: order.netRevenue * fx,
          feesBase: fees * fx,
          feesSource,
          cogsBase: cogs,
          cogsMissing: missing,
          cogsSource,
        })
        .where(eq(schema.orders.id, order.id));

      for (const r of refunds.filter((r) => r.orderId === order.id)) {
        const amountBase = await toBase(r.amountNet, order.currency, r.refundDate);
        await db.update(schema.refunds).set({ amountBase }).where(eq(schema.refunds.id, r.id));
      }
    }
  }
}

/** Recompute every order containing one of these SKUs (after a cost change). */
export async function recomputeForSkus(skus: string[]): Promise<number> {
  if (!skus.length) return 0;
  const db = await getDb();
  const rows = await db
    .selectDistinct({ id: schema.orderLines.orderId })
    .from(schema.orderLines)
    .where(inArray(schema.orderLines.sku, skus));
  await recomputeOrders(rows.map((r) => r.id));
  return rows.length;
}

export async function recomputeForStore(storeId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.storeId, storeId));
  await recomputeOrders(rows.map((r) => r.id));
}
