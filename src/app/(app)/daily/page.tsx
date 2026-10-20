import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listStores } from "@/lib/stores";
import { dailyStatus, type DayStatus } from "@/lib/checklist";
import { addDays, daysBetween, today } from "@/lib/dates";
import { money } from "@/lib/format";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function DailyCheckPage(props: PageProps<"/daily">) {
  const sp = await props.searchParams;
  const to = isDate(sp.to) ? sp.to : today();
  const span = [7, 14, 31].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const from = addDays(to, -(span - 1));
  const stores = (await listStores()).filter((s) => s.active);
  const status = await dailyStatus(stores.map((s) => s.id), from, to);
  const days = daysBetween(from, to).reverse();

  const db = await getDb();
  const pending = await db
    .select({ storeId: schema.supplierInvoices.storeId, n: sql<number>`count(*)` })
    .from(schema.supplierInvoices)
    .where(sql`${schema.supplierInvoices.status} = 'pending'`)
    .groupBy(schema.supplierInvoices.storeId);
  const pendingBy = new Map(pending.map((p) => [p.storeId, Number(p.n)]));

  const summary = stores.map((s) => {
    const cells = [...status.get(s.id)!.values()];
    return {
      store: s,
      noAds: cells.filter((c) => c.orders > 0 && c.adRows === 0).length,
      noCpc: cells.filter((c) => c.adNoCpc > 0).length,
      notInvoiced: cells.reduce((n, c) => n + (c.sheetCogs && c.invoiced < c.orders ? 0 : c.orders - c.invoiced), 0),
      orders: cells.reduce((n, c) => n + c.orders, 0),
      pending: pendingBy.get(s.id) ?? 0,
    };
  });
  const qs = (t: string, d = span) => `/daily?to=${t}&days=${d}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Daily check</h1>
          <p className="text-sm text-muted">For each store and day: is the ad spend entered, and have the supplier invoices for that day&apos;s orders been uploaded? Click a day to see its orders.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 31].map((d) => (
            <Link key={d} href={qs(to, d)} className={d === span ? "btn" : "btn-ghost"}>{d} days</Link>
          ))}
          <Link className="btn-ghost" href={qs(addDays(to, -span))} aria-label="Earlier">←</Link>
          <Link className="btn-ghost" href={qs(addDays(to, span) > today() ? today() : addDays(to, span))} aria-label="Later">→</Link>
        </div>
      </header>

      {!stores.length && <p className="text-sm text-muted">No active stores. <Link className="underline" href="/stores/new">Add a store</Link>.</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(({ store, noAds, noCpc, notInvoiced, orders, pending }) => {
          const ok = !noAds && !noCpc && !notInvoiced && !pending && !store.lastSyncError;
          return (
            <div key={store.id} className="card space-y-1 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{store.name}</span>
                <span className={ok ? "text-positive" : "text-warn-text"}>{ok ? "✓ Up to date" : "Needs attention"}</span>
              </div>
              <div className={noAds ? "text-negative" : "text-muted"}>{noAds ? `${noAds} day${noAds === 1 ? "" : "s"} without ad spend` : "Ad spend entered every day"}</div>
              {noCpc > 0 && <div className="text-warn-text">{noCpc} day{noCpc === 1 ? "" : "s"} without CPC or CVR</div>}
              <div className={notInvoiced ? "text-warn-text" : "text-muted"}>
                {orders === 0 ? "No orders" : notInvoiced ? `${notInvoiced} of ${orders} orders not invoiced` : `All ${orders} orders invoiced`}
              </div>
              {pending > 0 && <Link href={`/invoices?store=${store.id}`} className="block text-accent underline">{pending} invoice{pending === 1 ? "" : "s"} waiting for review</Link>}
              {store.lastSyncError ? (
                <div className="text-negative">Sync failed: {store.lastSyncError}</div>
              ) : (
                <div className="text-xs text-muted">Last synced {store.lastSyncedAt ? store.lastSyncedAt.toLocaleString("en-GB") : "never"}</div>
              )}
            </div>
          );
        })}
      </section>

      {stores.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Day</th>
                {stores.map((s) => <th key={s.id} className="min-w-44">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className="align-top">
                  <td className="num whitespace-nowrap">{new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}</td>
                  {stores.map((s) => <Cell key={s.id} storeId={s.id} date={d} c={status.get(s.id)!.get(d)!} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Invoices usually arrive a few days after the orders, so recent days are expected to be partly invoiced. Orders not invoiced yet use the SKU-cost estimate.</p>
    </div>
  );
}

function Cell({ storeId, date, c }: { storeId: number; date: string; c: DayStatus }) {
  const orders = `/orders?store=${storeId}&from=${date}&to=${date}`;
  return (
    <td className="space-y-0.5">
      <div className={c.adRows ? "text-positive" : c.orders ? "font-medium text-negative" : "text-muted"}>
        {c.adRows ? `✓ Ads ${money(c.adSpend, c.adCurrency ?? "USD")}` : c.orders ? "✗ No ad spend" : "No ad spend"}
      </div>
      {c.adNoCpc > 0 && <div className="text-xs text-warn-text">CPC or CVR missing</div>}
      <div>
        {c.orders === 0 ? (
          <span className="text-muted">No orders</span>
        ) : c.invoiced === c.orders ? (
          <Link href={orders} className="text-positive hover:underline">✓ {c.orders} invoiced</Link>
        ) : c.sheetCogs ? (
          <Link href={orders} className="text-positive hover:underline" title="Cost of goods from the old profit sheet">✓ COG from sheet ({c.orders} orders)</Link>
        ) : (
          <Link href={`${orders}&invoiced=0`} className="text-warn-text hover:underline">{c.invoiced} of {c.orders} invoiced</Link>
        )}
      </div>
      {c.missingCost > 0 && !c.sheetCogs && <Link href={`${orders}&missing=1`} className="block text-xs text-negative hover:underline">⚠ {c.missingCost} without any cost</Link>}
      {c.refunds > 0 && <div className="text-xs text-muted">{c.refunds} refund{c.refunds === 1 ? "" : "s"}</div>}
    </td>
  );
}
