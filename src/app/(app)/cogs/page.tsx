import Link from "next/link";
import { listStores } from "@/lib/stores";
import { cogsDay, type CogsOrder } from "@/lib/cogs-check";
import { addDays, today } from "@/lib/dates";
import { money, pct } from "@/lib/format";
import { Kpis } from "../sheet-parts";

const SOURCE: Record<CogsOrder["source"], string> = { invoice: "Supplier invoice", estimate: "SKU-cost estimate", missing: "No cost yet" };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One store's day, order by order: what the customer paid next to what the supplier charged. */
export default async function CogsCheckPage(props: PageProps<"/cogs">) {
  const sp = await props.searchParams;
  const stores = (await listStores()).filter((s) => s.active);
  if (!stores.length) return <p className="text-sm text-muted">Add a store first.</p>;
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const date = isDate(sp.date) ? sp.date : addDays(today(), -1);
  const day = await cogsDay(store, date);
  const cur = day.currency;
  const m = (n: number | null) => (n == null ? "" : money(n, cur));
  const ratio = (cost: number, sold: number) => (sold ? cost / sold : null);
  const invoiced = day.orders.filter((o) => o.source === "invoice");
  const supplier = invoiced.reduce((n, o) => n + o.cost, 0);
  const qs = (d: string, s = store.id) => `/cogs?store=${s}&date=${d}`;
  const sum = (f: (o: CogsOrder) => number | null) => day.orders.reduce((n, o) => n + (f(o) ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Cost of goods check</h1>
          <p className="text-sm text-muted">Every order of one day: what the customer paid (excl. VAT, incl. shipping) next to what the supplier charged, in {cur}.</p>
        </div>
        <p className="text-right text-sm">
          {store.cogsTargetPct != null ? (
            <>Target cost of goods for {store.name}: <b>{store.cogsTargetPct}%</b> of sales</>
          ) : (
            <span className="text-muted">No target set for {store.name}. <Link className="underline" href={`/stores/${store.id}`}>Set one</Link></span>
          )}
        </p>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Stores">
        {stores.map((s) => (
          <Link key={s.id} href={qs(date, s.id)} className={`store-tab ${s.id === store.id ? "store-tab-on" : ""}`}>{s.name}</Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn-ghost" href={qs(addDays(date, -1))} aria-label="Previous day">←</Link>
        <form className="flex gap-2" action="/cogs">
          <input type="hidden" name="store" value={store.id} />
          <input type="date" name="date" defaultValue={date} max={today()} className="input w-auto" aria-label="Day" />
          <button className="btn-ghost">Show</button>
        </form>
        <Link className="btn-ghost" href={qs(addDays(date, 1) > today() ? today() : addDays(date, 1))} aria-label="Next day">→</Link>
        <span className="font-medium">{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</span>
        {day.orders.length > 0 && <a className="btn-ghost ml-auto" href={`/cogs/export?store=${store.id}&date=${date}`}>Download sheet (CSV)</a>}
      </div>

      <Kpis
        items={[
          { label: "Sold for", value: money(day.soldFor, cur), sub: `${day.orders.length} order${day.orders.length === 1 ? "" : "s"}, excl. VAT` },
          { label: "Cost of goods", value: money(day.cost, cur), sub: day.dayWise ? "the old sheet's figure for the day" : `${invoiced.length} of ${day.orders.length} from supplier invoices` },
          { label: "Cost of goods %", value: pct(ratio(day.cost, day.soldFor)), sub: "cost of goods ÷ sold for" },
          { label: "Invoiced orders only", value: pct(ratio(supplier, invoiced.reduce((n, o) => n + o.soldFor, 0))), sub: `${money(supplier, cur)} charged by the supplier` },
        ]}
      />

      {day.dayWise && (
        <p className="alert-warn text-sm">This day is before the old profit sheet ends, so its cost of goods is the sheet&apos;s day total ({m(day.sheetCogs) || "none entered"}), not per order. The per-order costs below are SKU-cost estimates.</p>
      )}
      {!day.dayWise && day.orders.length > invoiced.length && (
        <p className="alert-warn text-sm">
          {day.orders.length - invoiced.length} order{day.orders.length - invoiced.length === 1 ? " isn't" : "s aren't"} on a supplier invoice yet, so {day.orders.length - invoiced.length === 1 ? "its" : "their"} cost is an estimate. <Link className="underline" href={`/?store=${store.id}`}>Upload the invoice on {store.name}&apos;s sheet</Link>
        </p>
      )}

      <section className="card overflow-x-auto">
        <table className="table num [&_td]:text-right [&_th]:text-right [&_td:nth-child(-n+3)]:text-left [&_th:nth-child(-n+3)]:text-left">
          <thead>
            <tr className="grp-head">
              <th colSpan={3}></th>
              <th colSpan={2} className="grp-start !text-center">Customer</th>
              <th colSpan={3} className="grp-start grp-ads !text-center">Supplier</th>
              <th colSpan={3} className="grp-start grp-result !text-center">Cost of goods</th>
            </tr>
            <tr>
              <th>Order</th><th>Time</th><th>Products</th>
              <th className="grp-start">Sold for</th><th>Refunded</th>
              <th className="grp-start grp-ads">Products</th><th className="grp-ads">Shipping</th><th className="grp-ads">Other</th>
              <th className="grp-start">Total</th><th>COG %</th><th className="!text-left">From</th>
            </tr>
          </thead>
          <tbody>
            {day.orders.map((o) => (
              <tr key={o.name}>
                <td className="font-medium">{o.name}</td>
                <td className="text-muted">{o.time}</td>
                <td className="max-w-80 truncate !whitespace-nowrap" title={o.products}>{o.products || <span className="text-muted">—</span>}</td>
                <td className="grp-start">{m(o.soldFor)}</td>
                <td className={o.refunded ? "text-negative" : ""}>{o.refunded ? m(o.refunded) : ""}</td>
                <td className="grp-start grp-ads">{m(o.productCost)}</td>
                <td className="grp-ads">{m(o.shippingCost)}</td>
                <td className="grp-ads">{m(o.otherCost)}</td>
                <td className="grp-start font-semibold">{o.source === "missing" ? <span className="text-negative">—</span> : m(o.cost)}</td>
                <td>{o.source === "missing" ? "" : pct(ratio(o.cost, o.soldFor))}</td>
                <td className={`!text-left text-xs ${o.source === "invoice" ? "text-positive" : o.source === "missing" ? "text-negative" : "text-warn-text"}`}>{SOURCE[o.source]}</td>
              </tr>
            ))}
            {day.orders.length > 0 && (
              <tr className="total-row font-semibold">
                <td colSpan={3}>Day total</td>
                <td className="grp-start">{m(day.soldFor)}</td>
                <td>{m(sum((o) => o.refunded))}</td>
                <td className="grp-start">{m(sum((o) => o.productCost))}</td>
                <td>{m(sum((o) => o.shippingCost))}</td>
                <td>{m(sum((o) => o.otherCost))}</td>
                <td className="grp-start">{m(day.cost)}</td>
                <td>{pct(ratio(day.cost, day.soldFor))}</td>
                <td className="!text-left text-xs">{day.dayWise ? "Old sheet (day)" : `${invoiced.length}/${day.orders.length} invoiced`}</td>
              </tr>
            )}
            {!day.orders.length && <tr><td colSpan={11} className="py-8 !text-center text-muted">No orders on this day.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
