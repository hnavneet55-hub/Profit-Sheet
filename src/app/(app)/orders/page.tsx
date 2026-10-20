import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listStores } from "@/lib/stores";
import { addDays, today } from "@/lib/dates";
import { money } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";

export default async function OrdersPage(props: PageProps<"/orders">) {
  const sp = await props.searchParams;
  const to = typeof sp.to === "string" ? sp.to : today();
  const from = typeof sp.from === "string" ? sp.from : addDays(to, -6);
  const storeId = Number(sp.store) || undefined;
  const missing = sp.missing === "1";
  const invoiced = sp.invoiced === "0" ? false : sp.invoiced === "1" ? true : undefined;
  const db = await getDb();
  const stores = await listStores();
  const rows = await db
    .select({
      o: schema.orders,
      store: schema.stores.name,
      refunded: sql<number>`coalesce((select sum(r.amount_base) from refunds r where r.order_id = ${schema.orders.id}), 0)`,
    })
    .from(schema.orders)
    .innerJoin(schema.stores, eq(schema.orders.storeId, schema.stores.id))
    .where(
      and(
        gte(schema.orders.orderDate, from),
        lte(schema.orders.orderDate, to),
        storeId ? eq(schema.orders.storeId, storeId) : undefined,
        missing ? eq(schema.orders.cogsMissing, true) : undefined,
        invoiced === undefined ? undefined : invoiced ? eq(schema.orders.cogsSource, "invoice") : ne(schema.orders.cogsSource, "invoice"),
      ),
    )
    .orderBy(desc(schema.orders.createdAt))
    .limit(500);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="text-sm text-muted">Per-order profit in {BASE_CURRENCY}, before ad spend. COGS marked “inv.” comes from a supplier invoice, the rest is the SKU-cost estimate. Showing up to 500.</p>
        </div>
        <form className="flex flex-wrap items-center gap-2">
          <select name="store" defaultValue={storeId ?? ""} className="input w-auto">
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" name="from" defaultValue={from} className="input w-auto" />
          <input type="date" name="to" defaultValue={to} className="input w-auto" />
          <select name="invoiced" defaultValue={sp.invoiced === "0" || sp.invoiced === "1" ? sp.invoiced : ""} className="input w-auto">
            <option value="">Invoiced or not</option>
            <option value="1">Invoiced</option>
            <option value="0">Not invoiced</option>
          </select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="missing" value="1" defaultChecked={missing} /> Missing cost</label>
          <button className="btn-ghost">Filter</button>
        </form>
      </header>
      <div className="card overflow-x-auto">
        <table className="table num [&_td.r]:text-right [&_th.r]:text-right">
          <thead>
            <tr><th>Order</th><th>Store</th><th>Date</th><th className="r">Total ({"shop"})</th><th className="r">Revenue</th><th className="r">Refunded</th><th className="r">COGS</th><th className="r">Fees</th><th className="r">Profit</th></tr>
          </thead>
          <tbody>
            {rows.map(({ o, store, refunded }) => {
              const profit = (o.netRevenueBase ?? 0) - Number(refunded) - (o.cogsBase ?? 0) - (o.feesBase ?? 0);
              return (
                <tr key={o.id} className={o.cancelled ? "text-muted line-through" : ""}>
                  <td className="font-medium">{o.name}</td>
                  <td>{store}</td>
                  <td>{o.orderDate}</td>
                  <td className="r">{money(o.totalPrice, o.currency)}</td>
                  <td className="r">{money(o.netRevenueBase, BASE_CURRENCY)}</td>
                  <td className="r">{Number(refunded) ? money(Number(refunded), BASE_CURRENCY) : ""}</td>
                  <td className="r">
                    {o.cogsMissing ? <span className="text-warn-text" title="Some products have no cost">⚠ {money(o.cogsBase, BASE_CURRENCY)}</span> : money(o.cogsBase, BASE_CURRENCY)}
                    {o.cogsSource === "invoice" && <span className="ml-1 text-xs text-positive" title="From a supplier invoice">inv.</span>}
                  </td>
                  <td className="r" title={o.feesSource === "reported" ? "Reported by Shopify" : "From the store's fee rule"}>{money(o.feesBase, BASE_CURRENCY)}</td>
                  <td className={`r font-semibold ${profit < 0 ? "text-negative" : ""}`}>{money(profit, BASE_CURRENCY)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-muted">No orders in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
