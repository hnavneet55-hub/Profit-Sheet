import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DISPUTES_QUERY, ORDERS_QUERY, shopifyGraphql, type DisputesPage, type OrdersPage, type ShopifyOrder } from "./shopify";
import { recomputeOrders } from "./costs";
import { toReportDate } from "./dates";

const INITIAL_DAYS = Number(process.env.INITIAL_SYNC_DAYS ?? 90);
// Leave headroom under the 300s function limit; the next run continues where this one stopped.
const TIME_BUDGET_MS = 240_000;

type Store = typeof schema.stores.$inferSelect;

const num = (s: string | undefined) => (s ? Number(s) : 0);

/** The order's chargeback state: a chargeback outranks an inquiry; the latest chargeback's status is kept. */
function disputeFields(disputes: ShopifyOrder["disputes"] | null | undefined) {
  const list = disputes ?? [];
  const chargebacks = list.filter((d) => d.initiatedAs === "CHARGEBACK");
  return {
    chargeback: chargebacks.length > 0,
    chargebackStatus: chargebacks.at(-1)?.status ?? null,
    inquiry: list.some((d) => d.initiatedAs === "INQUIRY"),
  };
}

async function saveOrder(store: Store, o: ShopifyOrder) {
  const db = await getDb();
  // When the customer paid in the store's report currency (the ad account's), use
  // what they paid instead of converting the shop-currency amount back again.
  const paidInReportCurrency = o.presentmentCurrencyCode === store.reportingCurrency && o.presentmentCurrencyCode !== o.currencyCode;
  const amount = (m: { shopMoney: { amount: string }; presentmentMoney?: { amount: string } }) =>
    num(paidInReportCurrency && m.presentmentMoney ? m.presentmentMoney.amount : m.shopMoney.amount);
  const currency = paidInReportCurrency ? o.presentmentCurrencyCode : o.currencyCode;
  const day = (d: string) => toReportDate(d, store.timezone ?? undefined);
  const totalPrice = amount(o.totalPriceSet);
  const totalTax = amount(o.totalTaxSet);
  const successful = o.transactions.filter((t) => t.status === "SUCCESS");
  const allFees = successful.flatMap((t) => t.fees);
  // Shopify reports fees in shop currency; scale them like the order total.
  const shopTotal = num(o.totalPriceSet.shopMoney.amount);
  const feeScale = paidInReportCurrency && shopTotal ? totalPrice / shopTotal : 1;
  const reportedFees = allFees.length ? allFees.reduce((s, f) => s + num(f.amount.amount), 0) * feeScale : null;
  const gateways = [...new Set(successful.map((t) => t.gateway).filter(Boolean))].join(",");
  // Voided/expired authorisations never captured money.
  const cancelled = !!o.cancelledAt || ["VOIDED", "EXPIRED"].includes(o.displayFinancialStatus ?? "");

  const row = {
    id: o.id,
    storeId: store.id,
    name: o.name,
    createdAt: new Date(o.createdAt),
    orderDate: day(o.createdAt),
    currency,
    cancelled,
    totalPrice,
    totalTax,
    netRevenue: cancelled && !o.refunds.length ? 0 : totalPrice - totalTax,
    reportedFees,
    gateways,
    ...disputeFields(o.disputes),
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
    const refunded = amount(r.totalRefundedSet);
    const values = {
      id: r.id,
      orderId: o.id,
      storeId: store.id,
      createdAt: new Date(r.createdAt),
      refundDate: day(r.createdAt),
      amount: refunded,
      amountNet: refunded * taxShare,
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
          subtotal: amount(n.subtotalSet),
          restockType: n.restockType,
        })),
      );
    }
  }
}

const DISPUTE_SWEEP_DAYS = 120;
const DISPUTE_SWEEP_EVERY_MS = 6 * 3600_000;

/** Re-reads the disputes of the last months' orders, since a bank dispute may not show up as an order update. */
async function sweepDisputes(store: Store, deadline: number) {
  const db = await getDb();
  const key = `disputes_sweep_${store.id}`;
  const [done] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  if (done && Date.now() - Number(done.value) < DISPUTE_SWEEP_EVERY_MS) return;
  const since = new Date(Date.now() - DISPUTE_SWEEP_DAYS * 86400_000).toISOString();
  let after: string | null = null;
  for (;;) {
    const page: DisputesPage = await shopifyGraphql<DisputesPage>(store, DISPUTES_QUERY, { first: 100, after, query: `created_at:>='${since}'` });
    for (const o of page.orders.nodes) await db.update(schema.orders).set(disputeFields(o.disputes)).where(eq(schema.orders.id, o.id));
    if (!page.orders.pageInfo.hasNextPage) break;
    if (Date.now() > deadline) return; // unfinished: the next run starts the sweep again
    after = page.orders.pageInfo.endCursor;
  }
  await db.insert(schema.settings).values({ key, value: String(Date.now()) }).onConflictDoUpdate({ target: schema.settings.key, set: { value: String(Date.now()) } });
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
      if (store.currency !== page.shop.currencyCode || store.timezone !== page.shop.ianaTimezone) {
        await db.update(schema.stores).set({ currency: page.shop.currencyCode, timezone: page.shop.ianaTimezone }).where(eq(schema.stores.id, store.id));
        store.currency = page.shop.currencyCode;
        store.timezone = page.shop.ianaTimezone;
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
        // Chargebacks are a side check: a failure here must not mark the order sync as failed.
        await sweepDisputes(store, deadline).catch((e) => console.error(`dispute sweep ${store.name}`, e));
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
