import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ORDERS_QUERY, shopifyGraphql, type OrdersPage, type ShopifyOrder } from "./shopify";
import { recomputeOrders } from "./costs";
import { toReportDate } from "./dates";

const INITIAL_DAYS = Number(process.env.INITIAL_SYNC_DAYS ?? 90);
// Leave headroom under the 300s function limit; the next run continues where this one stopped.
const TIME_BUDGET_MS = 240_000;

type Store = typeof schema.stores.$inferSelect;

const num = (s: string | undefined) => (s ? Number(s) : 0);

async function saveOrder(store: Store, o: ShopifyOrder) {
  const db = await getDb();
  const totalPrice = num(o.totalPriceSet.shopMoney.amount);
  const totalTax = num(o.totalTaxSet.shopMoney.amount);
  const successful = o.transactions.filter((t) => t.status === "SUCCESS");
  const allFees = successful.flatMap((t) => t.fees);
  const reportedFees = allFees.length ? allFees.reduce((s, f) => s + num(f.amount.amount), 0) : null;
  const gateways = [...new Set(successful.map((t) => t.gateway).filter(Boolean))].join(",");
  // Voided/expired authorisations never captured money.
  const cancelled = !!o.cancelledAt || ["VOIDED", "EXPIRED"].includes(o.displayFinancialStatus ?? "");

  const row = {
    id: o.id,
    storeId: store.id,
    name: o.name,
    createdAt: new Date(o.createdAt),
    orderDate: toReportDate(o.createdAt),
    currency: o.currencyCode,
    cancelled,
    totalPrice,
    totalTax,
    netRevenue: cancelled && !o.refunds.length ? 0 : totalPrice - totalTax,
    reportedFees,
    gateways,
    syncedAt: new Date(),
  };
  await db.insert(schema.orders).values(row).onConflictDoUpdate({ target: schema.orders.id, set: row });

  await db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, o.id));
  if (o.lineItems.nodes.length) {
    await db.insert(schema.orderLines).values(
      o.lineItems.nodes.map((l) => ({
        id: l.id,
        orderId: o.id,
        sku: (l.sku || l.name).trim(),
        name: l.name,
        quantity: l.quantity,
      })),
    );
  }

  const taxShare = totalPrice > 0 ? (totalPrice - totalTax) / totalPrice : 1;
  for (const r of o.refunds) {
    const amount = num(r.totalRefundedSet.shopMoney.amount);
    const values = {
      id: r.id,
      orderId: o.id,
      storeId: store.id,
      createdAt: new Date(r.createdAt),
      refundDate: toReportDate(r.createdAt),
      amount,
      amountNet: amount * taxShare,
      restockedQty: r.refundLineItems.nodes.filter((n) => n.restockType !== "NO_RESTOCK").reduce((s, n) => s + n.quantity, 0),
    };
    const { id, ...set } = values;
    void id;
    await db.insert(schema.refunds).values(values).onConflictDoUpdate({ target: schema.refunds.id, set });
    await db.delete(schema.refundLines).where(eq(schema.refundLines.refundId, r.id));
    if (r.refundLineItems.nodes.length) {
      await db.insert(schema.refundLines).values(
        r.refundLineItems.nodes.map((n) => ({
          refundId: r.id,
          orderId: o.id,
          sku: (n.lineItem.sku || n.lineItem.name).trim(),
          name: n.lineItem.name,
          quantity: n.quantity,
          subtotal: num(n.subtotalSet.shopMoney.amount),
          restockType: n.restockType,
        })),
      );
    }
  }
}

export type SyncResult = { storeId: number; store: string; orders: number; complete: boolean; error?: string };

export async function syncStore(store: Store, deadline = Date.now() + TIME_BUDGET_MS): Promise<SyncResult> {
  const db = await getDb();
  // Overlap by an hour so orders updated during the previous run aren't missed.
  const since = store.lastSyncedAt
    ? new Date(store.lastSyncedAt.getTime() - 3600_000)
    : new Date(Date.now() - INITIAL_DAYS * 86400_000);
  const query = `updated_at:>='${since.toISOString()}'${store.lastSyncedAt ? "" : ` created_at:>='${since.toISOString()}'`}`;

  let after: string | null = null;
  let count = 0;
  let lastUpdated: string | null = null;
  try {
    for (;;) {
      const page: OrdersPage = await shopifyGraphql<OrdersPage>(store, ORDERS_QUERY, { first: 50, after, query });
      if (!store.currency) {
        await db.update(schema.stores).set({ currency: page.shop.currencyCode }).where(eq(schema.stores.id, store.id));
        store.currency = page.shop.currencyCode;
      }
      const saved: string[] = [];
      for (const o of page.orders.nodes) {
        if (o.test) continue;
        await saveOrder(store, o);
        saved.push(o.id);
      }
      await recomputeOrders(saved);
      count += page.orders.nodes.length;
      const last = page.orders.nodes.at(-1);
      if (last) lastUpdated = last.updatedAt;

      if (!page.orders.pageInfo.hasNextPage) {
        await db
          .update(schema.stores)
          .set({ lastSyncedAt: new Date(), lastSyncError: null })
          .where(eq(schema.stores.id, store.id));
        return { storeId: store.id, store: store.name, orders: count, complete: true };
      }
      after = page.orders.pageInfo.endCursor;
      if (Date.now() > deadline) {
        // Orders are sorted by updated_at, so resume from the last one saved.
        await db
          .update(schema.stores)
          .set({ lastSyncedAt: lastUpdated ? new Date(lastUpdated) : store.lastSyncedAt, lastSyncError: null })
          .where(eq(schema.stores.id, store.id));
        return { storeId: store.id, store: store.name, orders: count, complete: false };
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.update(schema.stores).set({ lastSyncError: error }).where(eq(schema.stores.id, store.id));
    return { storeId: store.id, store: store.name, orders: count, complete: false, error };
  }
}

export async function syncStores(storeIds?: number[]): Promise<SyncResult[]> {
  const db = await getDb();
  const stores = await db
    .select()
    .from(schema.stores)
    .where(storeIds ? inArray(schema.stores.id, storeIds) : eq(schema.stores.active, true));
  const deadline = Date.now() + TIME_BUDGET_MS;
  return Promise.all(stores.map((s) => syncStore(s, deadline)));
}
