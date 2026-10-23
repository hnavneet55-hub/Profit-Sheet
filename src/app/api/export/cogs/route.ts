import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BASE_CURRENCY } from "@/lib/config";

const PAGE_SIZE = 20000;

function authorized(request: Request) {
  const key = process.env.COGS_EXPORT_KEY;
  if (!key) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${key}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Read-only export of order-line cost of goods for AdProfit, which matches lines by their
 * Shopify line item ID. Needs COGS_EXPORT_KEY as a Bearer token.
 * ?shop=x.myshopify.com&since=YYYY-MM-DD&after=<line id cursor from the previous page>
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const q = new URL(request.url).searchParams;
  const shop = (q.get("shop") ?? "").toLowerCase();
  const since = q.get("since") ?? "";
  const after = q.get("after") ?? "";
  if (!shop || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return new Response("shop and since are required", { status: 400 });

  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, shop));
  if (!store) return Response.json({ error: "store not found" }, { status: 404 });

  const rows = await db
    .select({
      orderId: schema.orders.id,
      orderDate: schema.orders.orderDate,
      cogsSource: schema.orders.cogsSource,
      orderCogsBase: schema.orders.cogsBase,
      lineId: schema.orderLines.id,
      sku: schema.orderLines.sku,
      quantity: schema.orderLines.quantity,
      unitCostBase: schema.orderLines.unitCostBase,
    })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orderLines.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.storeId, store.id),
        gte(schema.orders.orderDate, since),
        after ? gt(schema.orderLines.id, after) : undefined,
      ),
    )
    .orderBy(asc(schema.orderLines.id))
    .limit(PAGE_SIZE);

  return Response.json({
    currency: BASE_CURRENCY,
    rows,
    next: rows.length === PAGE_SIZE ? rows[rows.length - 1].lineId : null,
  });
}
