import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { EXTRACT_MODEL } from "./config";
import { recomputeOrders } from "./costs";
import { toBase } from "./fx";
import { today } from "./dates";
import { sheetCogsUntil } from "./report";
import { supplierContent, type SupplierInput } from "./supplier-files";

// Flag an order when the invoice differs this much from the SKU-cost estimate.
const ESTIMATE_DIFF_FLAG_PCT = 25;

const InvoiceSchema = z.object({
  supplier: z.string().nullable().describe("Supplier name if stated"),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("YYYY-MM-DD"),
  currency: z.string().describe("ISO 4217 code the invoice is billed in"),
  total: z.number().nullable().describe("Invoice grand total as printed, if any"),
  store_on_invoice: z.string().nullable().describe("Store name, shop URL or customer name printed on the invoice, if any"),
  store_check: z
    .enum(["matches", "different", "not_shown"])
    .describe("Whether the store shown on the invoice is the store it was uploaded for"),
  summary: z.string().describe("One or two sentences on what this invoice contains"),
  orders: z.array(
    z.object({
      order_ref: z.string().describe("The customer order number exactly as written, e.g. #1234 or DK1234"),
      items: z.array(
        z.object({
          description: z.string().describe("Product as the supplier wrote it"),
          sku: z.string().nullable(),
          quantity: z.number().nullable(),
        }),
      ),
      product_cost: z.number().describe("Total billed for the goods of this order"),
      shipping_cost: z.number().describe("Shipping billed for this order, 0 if none"),
      other_cost: z.number().describe("Any other charge for this order (handling, packaging, service fee); 0 if none"),
      currency: z.string().describe("ISO 4217 code"),
      notes: z.array(z.string()).describe("Problems a human should check for this order"),
    }),
  ),
  unallocated_costs: z
    .array(z.object({ description: z.string(), amount: z.number() }))
    .describe("Charges on the invoice that don't belong to a specific order"),
  notes: z.array(z.string()).describe("Problems with the invoice as a whole"),
});
type ParsedInvoice = z.infer<typeof InvoiceSchema>;

const SYSTEM = `You read supplier invoices for an e-commerce business. The supplier ships customer orders from Shopify stores and bills per order; the goal is the actual cost of each order.

Rules:
- Return one entry per customer order number. If an order has several product lines, list them in items and sum their cost into product_cost.
- order_ref is the store's order number exactly as the supplier wrote it, usually 3–6 digits like #1297. When a line shows both a long platform ID (e.g. 7164308488330) and a short order/reference number, use the short one. Never invent one; a line without an order number goes in unallocated_costs.
- A number inside a customer or account name (e.g. "#1757 John Smith") is not an order number.
- Split each order's charge into product_cost, shipping_cost and other_cost when the invoice shows them; otherwise put everything in product_cost and say so once in the invoice notes, not on every order. Fulfillment or service fees that include shipping go in shipping_cost; duties and other fees in other_cost.
- If a fee is shown both before and after a discount (e.g. "service fee" and "net service fee"), use the amount actually charged. When a row has its own total, the three costs must add up to it.
- Supplier credits or refunds for an order are negative amounts, with a note.
- Charges for the invoice as a whole (bank fee, monthly fee) go in unallocated_costs. Don't spread them over orders.
- Order notes are only for problems with that specific order: every note makes a person check the order by hand. Things that apply to all orders go in the invoice notes, once.
- Never guess a currency silently. If none is stated, use the most likely one and add a note saying it was assumed.
- If the order costs don't add up to the printed total, or anything else looks wrong, add a note.`;

export async function extract(input: SupplierInput, store: { name: string; shopDomain: string }, otherStores: string[], model: string = EXTRACT_MODEL): Promise<{ parsed: ParsedInvoice; usage: Anthropic.Beta.BetaUsage }> {
  const client = new Anthropic();
  const context = [
    `This invoice was uploaded for the store "${store.name}" (${store.shopDomain}).`,
    otherStores.length ? `Our other stores: ${otherStores.join(", ")}.` : "",
    `Today is ${today()}.`,
  ]
    .filter(Boolean)
    .join("\n");
  // Streamed: long outputs exceed the SDK's limit for a single non-streaming request.
  const res = await client.beta.messages
    .stream({
      model,
      max_tokens: 64000,
      system: SYSTEM,
      messages: [{ role: "user", content: supplierContent(input, context, "supplier invoice") }],
      output_config: { effort: "medium", format: zodOutputFormat(InvoiceSchema) },
      // Haiku has no server-side fallback.
      ...(model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new Error("Claude declined to process this invoice.");
  if (res.stop_reason === "max_tokens") throw new Error("The invoice is too long to read in one pass. Split it and try again.");
  if (!res.parsed_output) throw new Error("Claude's answer could not be read. Try again.");
  return { parsed: res.parsed_output, usage: res.usage };
}

/** "#1234", "1234 ", "dk-1234" → "1234" / "dk1234": case, spaces, # and dashes don't matter. */
const normalize = (ref: string) => ref.toLowerCase().replace(/[\s#\-_.]/g, "");
const digits = (ref: string) => ref.replace(/\D/g, "");

type OrderIndex = { exact: Map<string, string>; byDigits: Map<string, string[]> };

async function orderIndex(storeId: number): Promise<OrderIndex> {
  const db = await getDb();
  const rows = await db.select({ id: schema.orders.id, name: schema.orders.name }).from(schema.orders).where(eq(schema.orders.storeId, storeId));
  const exact = new Map<string, string>();
  const byDigits = new Map<string, string[]>();
  for (const r of rows) {
    exact.set(normalize(r.name), r.id);
    // Some suppliers print Shopify's internal order ID (the number at the end of the GID).
    const legacyId = r.id.match(/\/(\d{8,})$/)?.[1]; // long enough never to look like an order number
    if (legacyId) exact.set(legacyId, r.id);
    const d = digits(r.name);
    if (d) byDigits.set(d, [...(byDigits.get(d) ?? []), r.id]);
  }
  return { exact, byDigits };
}

/** The store's order this reference means, if exactly one fits. */
function findOrder(index: OrderIndex, ref: string): string | null {
  const hit = index.exact.get(normalize(ref));
  if (hit) return hit;
  // The supplier may drop or add a prefix ("DK1234" vs "#1234").
  const d = digits(ref);
  const candidates = d ? (index.byDigits.get(d) ?? []) : [];
  return candidates.length === 1 ? candidates[0] : null;
}

/** Problems with billing `orderId` at this cost, checked against the synced order. */
async function checkOrder(
  orderId: string,
  entry: ParsedInvoice["orders"][number],
  amountBase: number | null,
  invoiceId: number,
  invoiceDate: string | null,
): Promise<{ flags: string[]; estimatedCostBase: number | null }> {
  const db = await getDb();
  const flags: string[] = [];
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId));
  if (order.cancelled) flags.push("Order was cancelled: check the supplier should have billed it");
  if (invoiceDate && invoiceDate < order.orderDate) flags.push(`Invoice is dated before the order (${order.orderDate})`);
  const sheetUntil = (await sheetCogsUntil()).get(order.storeId);
  if (sheetUntil && order.orderDate <= sheetUntil)
    flags.push(`Order is from ${order.orderDate}, which the old profit sheet covers (until ${sheetUntil}): that day's cost of goods stays the sheet's figure`);

  const others = await db
    .select({ invoiceId: schema.invoiceOrders.invoiceId, number: schema.supplierInvoices.invoiceNumber })
    .from(schema.invoiceOrders)
    .innerJoin(schema.supplierInvoices, eq(schema.invoiceOrders.invoiceId, schema.supplierInvoices.id))
    .where(and(eq(schema.invoiceOrders.orderId, orderId), ne(schema.invoiceOrders.invoiceId, invoiceId), ne(schema.invoiceOrders.status, "rejected")));
  for (const o of others) flags.push(`Already on invoice ${o.number ?? `#${o.invoiceId}`}: possible double billing`);

  const ordered = lines.reduce((n, l) => n + l.quantity, 0);
  const qtys = entry.items.map((i) => i.quantity);
  if (qtys.length && qtys.every((q) => q != null)) {
    const billed = qtys.reduce((n: number, q) => n + (q ?? 0), 0);
    if (billed !== ordered) flags.push(`Invoice has ${billed} unit${billed === 1 ? "" : "s"}, the order has ${ordered}`);
  }
  // Suppliers often use their own codes; only compare SKUs when the invoice uses ours.
  const orderSkus = new Set(lines.map((l) => l.sku.toLowerCase()));
  const invoiceSkus = entry.items.flatMap((i) => (i.sku ? [i.sku] : []));
  if (invoiceSkus.some((s) => orderSkus.has(s.toLowerCase()))) {
    for (const s of invoiceSkus) if (!orderSkus.has(s.toLowerCase())) flags.push(`SKU ${s} isn't on this order`);
  }

  // The SKU-cost estimate, when every line has a cost.
  const estimatedCostBase = lines.length && lines.every((l) => l.unitCostBase != null) ? lines.reduce((n, l) => n + l.unitCostBase! * l.quantity, 0) : null;
  if (estimatedCostBase && amountBase != null) {
    const diff = ((amountBase - estimatedCostBase) / estimatedCostBase) * 100;
    if (Math.abs(diff) >= ESTIMATE_DIFF_FLAG_PCT) flags.push(`${Math.abs(diff).toFixed(0)}% ${diff > 0 ? "above" : "below"} the SKU-cost estimate`);
  }
  return { flags, estimatedCostBase };
}

/** Reads an invoice with Claude, matches it to the store's orders and stores it for review. */
export async function importInvoice(input: SupplierInput, storeId: number, filename: string, forDate?: string): Promise<number> {
  const db = await getDb();
  const [imp] = await db.insert(schema.supplierInvoices).values({ storeId, filename, status: "processing" }).returning({ id: schema.supplierInvoices.id });
  try {
    const stores = await db.select().from(schema.stores);
    const store = stores.find((s) => s.id === storeId);
    if (!store) throw new Error("Store not found");
    const { parsed } = await extract(input, store, stores.filter((s) => s.id !== storeId).map((s) => `${s.name} (${s.shopDomain})`));
    await saveInvoice(imp.id, store, stores, parsed, forDate);
  } catch (e) {
    await db
      .update(schema.supplierInvoices)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .where(eq(schema.supplierInvoices.id, imp.id));
  }
  return imp.id;
}

type Store = typeof schema.stores.$inferSelect;

/**
 * Matches Claude's reading of an invoice to orders and records it as pending review.
 * `forDate` is the order day it was uploaded for, if any.
 */
export async function saveInvoice(invoiceId: number, store: Store, stores: Store[], parsed: ParsedInvoice, forDate?: string): Promise<void> {
  const db = await getDb();
  const invoiceDate = parsed.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice_date) ? parsed.invoice_date : null;
  const index = await orderIndex(store.id);
  const otherIndexes = new Map<Store, OrderIndex>();
  for (const s of stores) if (s.id !== store.id) otherIndexes.set(s, await orderIndex(s.id));

  const invoiceFlags = [...parsed.notes];
  if (parsed.store_check === "different") {
    invoiceFlags.push(`The invoice looks like it's for ${parsed.store_on_invoice ?? "another store"}, not ${store.name}`);
  }
  for (const u of parsed.unallocated_costs) {
    invoiceFlags.push(`${u.description} (${u.amount} ${parsed.currency}) isn't for a specific order, so it isn't counted`);
  }
  const sameCurrency = parsed.orders.every((o) => o.currency.toUpperCase() === parsed.currency.toUpperCase());
  if (parsed.total != null && sameCurrency) {
    const sum = parsed.orders.reduce((n, o) => n + o.product_cost + o.shipping_cost + o.other_cost, 0) + parsed.unallocated_costs.reduce((n, u) => n + u.amount, 0);
    if (Math.abs(sum - parsed.total) > Math.max(0.01, Math.abs(parsed.total) * 0.005)) {
      invoiceFlags.push(`The lines add up to ${sum.toFixed(2)}, the invoice total is ${parsed.total.toFixed(2)}`);
    }
  }

  const seen = new Set<string>();
  const rows = [];
  for (const o of parsed.orders) {
    const flags = [...o.notes];
    const currency = o.currency.toUpperCase();
    const orderId = findOrder(index, o.order_ref);
    let amountBase: number | null = null;
    let estimatedCostBase: number | null = null;
    if (orderId) {
      const [order] = await db.select({ orderDate: schema.orders.orderDate }).from(schema.orders).where(eq(schema.orders.id, orderId));
      try {
        amountBase = await toBase(o.product_cost + o.shipping_cost + o.other_cost, currency, order.orderDate);
      } catch {
        flags.push(`Unknown currency ${currency}`);
      }
      const check = await checkOrder(orderId, o, amountBase, invoiceId, invoiceDate);
      flags.push(...check.flags);
      estimatedCostBase = check.estimatedCostBase;
      if (seen.has(orderId)) flags.push("This order appears more than once on the invoice");
      seen.add(orderId);
    } else {
      const elsewhere = [...otherIndexes].filter(([, idx]) => findOrder(idx, o.order_ref)).map(([s]) => s.name);
      flags.push(
        elsewhere.length
          ? `Not an order in ${store.name}, but ${elsewhere.join(" and ")} ${elsewhere.length === 1 ? "has" : "have"} an order ${o.order_ref}`
          : `No order ${o.order_ref} in ${store.name} (not synced yet, or a typo): type the order number to match it`,
      );
    }
    rows.push({
      invoiceId,
      orderRef: o.order_ref,
      orderId,
      items: o.items,
      productCost: o.product_cost,
      shippingCost: o.shipping_cost,
      otherCost: o.other_cost,
      currency,
      amountBase,
      estimatedCostBase,
      flags,
    });
  }
  if (rows.length) await db.insert(schema.invoiceOrders).values(rows);
  if (!rows.length) invoiceFlags.push("No order numbers found on this invoice");
  invoiceFlags.unshift(...(await coverageFlags(invoiceId, rows.flatMap((r) => (r.orderId ? [r.orderId] : [])), forDate)));
  await db
    .update(schema.supplierInvoices)
    .set({
      status: "pending",
      supplier: parsed.supplier,
      invoiceNumber: parsed.invoice_number,
      invoiceDate,
      currency: parsed.currency.toUpperCase(),
      total: parsed.total,
      storeOnInvoice: parsed.store_on_invoice,
      summary: parsed.summary,
      flags: invoiceFlags,
    })
    .where(eq(schema.supplierInvoices.id, invoiceId));
}

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The mistakes that leave orders uninvoiced although the upload "worked": a bill that was
 * already applied, or a file whose orders aren't from the day it was uploaded for.
 */
async function coverageFlags(invoiceId: number, orderIds: string[], forDate?: string): Promise<string[]> {
  if (!orderIds.length) return [];
  const db = await getDb();
  const flags: string[] = [];
  const applied = await db
    .selectDistinct({ orderId: schema.invoiceOrders.orderId, number: schema.supplierInvoices.invoiceNumber, invoiceId: schema.invoiceOrders.invoiceId })
    .from(schema.invoiceOrders)
    .innerJoin(schema.supplierInvoices, eq(schema.invoiceOrders.invoiceId, schema.supplierInvoices.id))
    .where(and(inArray(schema.invoiceOrders.orderId, orderIds), ne(schema.invoiceOrders.invoiceId, invoiceId), eq(schema.invoiceOrders.status, "approved")));
  const done = new Set(applied.map((a) => a.orderId));
  if (orderIds.every((id) => done.has(id))) {
    const bills = [...new Set(applied.map((a) => a.number ?? `#${a.invoiceId}`))].join(", ");
    flags.push(`Nothing new: every order on this file is already applied from ${bills}. This is a re-upload, so it changes nothing; delete it.`);
  }
  if (forDate) {
    const dates = (await db.select({ d: schema.orders.orderDate }).from(schema.orders).where(inArray(schema.orders.id, orderIds))).map((o) => o.d).sort();
    if (!dates.includes(forDate)) {
      const span = dates[0] === dates.at(-1) ? day(dates[0]) : `${day(dates[0])} to ${day(dates.at(-1)!)}`;
      flags.push(`Uploaded for ${day(forDate)}, but none of its orders are from ${day(forDate)} (they're from ${span}). ${day(forDate)}'s orders stay not invoiced until the supplier's bill for them is uploaded.`);
    }
  }
  return flags;
}

/** Points an unmatched invoice line at the order the user typed, re-running the checks. */
export async function rematchInvoiceOrder(rowId: number, ref: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(schema.invoiceOrders).where(eq(schema.invoiceOrders.id, rowId));
  const [inv] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, row.invoiceId));
  const orderId = findOrder(await orderIndex(inv.storeId), ref);
  if (!orderId) {
    await db.update(schema.invoiceOrders).set({ flags: [`No order ${ref} in this store`] }).where(eq(schema.invoiceOrders.id, rowId));
    return;
  }
  const [order] = await db.select({ orderDate: schema.orders.orderDate }).from(schema.orders).where(eq(schema.orders.id, orderId));
  let amountBase: number | null = null;
  const flags = [`Matched by hand to ${ref} (supplier wrote ${row.orderRef})`];
  try {
    amountBase = await toBase(row.productCost + row.shippingCost + row.otherCost, row.currency, order.orderDate);
  } catch {
    flags.push(`Unknown currency ${row.currency}`);
  }
  const entry = { order_ref: row.orderRef, items: row.items, product_cost: row.productCost, shipping_cost: row.shippingCost, other_cost: row.otherCost, currency: row.currency, notes: [] };
  const check = await checkOrder(orderId, entry, amountBase, inv.id, inv.invoiceDate);
  await db
    .update(schema.invoiceOrders)
    .set({ orderId, amountBase, estimatedCostBase: check.estimatedCostBase, flags: [...flags, ...check.flags] })
    .where(eq(schema.invoiceOrders.id, rowId));
}

/** Approves the ticked lines (the rest are rejected) and recalculates those orders' profit. */
export async function reviewInvoiceOrders(invoiceId: number, approvedIds: number[]): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.invoiceOrders)
    .where(and(eq(schema.invoiceOrders.invoiceId, invoiceId), eq(schema.invoiceOrders.status, "pending")));
  const approve = rows.filter((r) => approvedIds.includes(r.id) && r.orderId);
  const reject = rows.filter((r) => !approve.includes(r));
  if (approve.length) await db.update(schema.invoiceOrders).set({ status: "approved" }).where(inArray(schema.invoiceOrders.id, approve.map((r) => r.id)));
  if (reject.length) await db.update(schema.invoiceOrders).set({ status: "rejected" }).where(inArray(schema.invoiceOrders.id, reject.map((r) => r.id)));
  await db.update(schema.supplierInvoices).set({ status: "done" }).where(eq(schema.supplierInvoices.id, invoiceId));
  await recomputeOrders(approve.map((r) => r.orderId!));
}

/** Deletes an invoice; its orders go back to the SKU-cost estimate unless another invoice covers them. */
export async function deleteInvoice(invoiceId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select({ orderId: schema.invoiceOrders.orderId }).from(schema.invoiceOrders).where(eq(schema.invoiceOrders.invoiceId, invoiceId));
  await db.delete(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, invoiceId));
  await recomputeOrders(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])));
}
