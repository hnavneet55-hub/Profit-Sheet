// Fills the local database with a demo store so the dashboard can be tried
// without Shopify. Run: pnpm seed:demo  (local PGlite only)
import { getDb, schema } from "../src/db";
import { recomputeOrders } from "../src/lib/costs";
import { addDays, today } from "../src/lib/dates";

if (process.env.DATABASE_URL) throw new Error("Refusing to seed a real database");
const db = await getDb();
const [store] = await db
  .insert(schema.stores)
  .values({
    name: "Demo DK",
    shopDomain: "demo-dk.myshopify.com",
    currency: "EUR",
    reportingCurrency: "EUR",
    authType: "token",
    paymentFeePct: 0,
    paymentFeeFixed: 0,
    mediaBuyerFeePct: 10,
    useReportedFees: true,
  })
  .returning();

await db.insert(schema.productCosts).values([
  { sku: "MUG-01", unitCost: 33, currency: "EUR", effectiveFrom: "2000-01-01" },
  { sku: "TEE-02", unitCost: 60, currency: "DKK", effectiveFrom: "2000-01-01" },
]);

// The spreadsheet example: 100 gross, 1 refunded, 33 COGS, 33 ad spend, 20 fees.
const day1 = addDays(today(), -10);
const ids: string[] = [];
const order = async (n: number, date: string, gross: number, fees: number, lines: [string, number][]) => {
  const id = `gid://demo/Order/${n}`;
  ids.push(id);
  await db.insert(schema.orders).values({
    id, storeId: store.id, name: `#${1000 + n}`, createdAt: new Date(`${date}T10:00:00Z`), orderDate: date,
    currency: "EUR", totalPrice: gross * 1.25, totalTax: gross * 0.25, netRevenue: gross, reportedFees: fees, gateways: "shopify_payments",
  });
  await db.insert(schema.orderLines).values(lines.map(([sku, q], i) => ({ id: `${id}/L${i}`, orderId: id, sku, name: sku === "MUG-01" ? "Enamel mug" : "Logo tee", quantity: q })));
  return id;
};
const first = await order(1, day1, 100, 20, [["MUG-01", 1]]);
await db.insert(schema.refunds).values({ id: "gid://demo/Refund/1", orderId: first, storeId: store.id, createdAt: new Date(`${day1}T15:00:00Z`), refundDate: day1, amount: 1.25, amountNet: 1 });
await db.insert(schema.refundLines).values({ refundId: "gid://demo/Refund/1", orderId: first, sku: "MUG-01", name: "Enamel mug", quantity: 1, subtotal: 1.25, restockType: "NO_RESTOCK" });
await db.insert(schema.adSpend).values({ date: day1, storeId: store.id, currency: "EUR", amount: 33, amountBase: 0 });

for (let d = 1; d < 10; d++) {
  const date = addDays(day1, d);
  for (let k = 0; k < 3 + (d % 4); k++) await order(d * 10 + k, date, 40 + ((d * 7 + k * 13) % 60), 2.5, [["MUG-01", 1], ["TEE-02", k % 2], ["NEW-SKU", d === 5 && k === 0 ? 1 : 0]].filter(([, q]) => q) as [string, number][]);
  await db.insert(schema.adSpend).values({ date, storeId: store.id, currency: "EUR", amount: 30 + d * 3, amountBase: 0 });
}
// Ad spend rows need their base amount; recompute does orders and refunds.
const { toBase } = await import("../src/lib/fx");
for (const a of await db.select().from(schema.adSpend)) {
  const { eq } = await import("drizzle-orm");
  await db.update(schema.adSpend).set({ amountBase: await toBase(a.amount, a.currency, a.date) }).where(eq(schema.adSpend.id, a.id));
}
await recomputeOrders(ids);
console.log(`Seeded demo store with ${ids.length} orders. First day: ${day1}`);
process.exit(0);
