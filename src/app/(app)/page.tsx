import Link from "next/link";
import { buildSheet, ratios, type DayRow } from "@/lib/report";
import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { today } from "@/lib/dates";
import { money, pct, ratio, monthLabel, shortDate } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";
import { ProfitChart } from "@/components/profit-chart";
import { syncNow } from "../actions";

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function ProfitSheetPage(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today().slice(0, 7);
  const storeId = Number(sp.store) || undefined;
  const stores = await listStores();
  const store = stores.find((s) => s.id === storeId);
  const { from, to } = monthRange(month);
  const sheet = await buildSheet({ storeId, from, to });
  const cur = sheet.currency;
  const t = sheet.total;
  const tr = ratios(t);
  const lastDay = to < today() ? to : today();
  const visibleDays = sheet.days.filter((d) => d.date <= lastDay);
  const noAdDays = visibleDays.filter((d) => d.orders > 0 && d.adSpend === 0).length;
  const syncErrors = stores.filter((s) => s.active && s.lastSyncError);
  const notInvoiced = t.orders - t.ordersInvoiced;
  const span = sp.span === "ytd" || sp.span === "all" ? sp.span : "month";
  const qs = (m: string, s?: number, sp2 = span) => `/?month=${m}${s ? `&store=${s}` : ""}${sp2 !== "month" ? `&span=${sp2}` : ""}`;

  const kpis = [
    { label: "Revenue", value: money(t.revenue, cur), sub: `after ${money(t.refunds, cur)} refunds` },
    { label: "Profit", value: money(t.profit, cur), sub: `${pct(tr.profitPct)} of gross`, tone: t.profit < 0 ? "neg" : undefined },
    { label: "Ad spend", value: money(t.adSpend, cur), sub: `+ ${money(t.mediaFee, cur)} media buyer fee` },
    { label: "ROAS", value: ratio(tr.roas), sub: `gross ${ratio(tr.grossRoas)}` },
    { label: "POAS", value: ratio(tr.poas), sub: "profit ÷ ad spend" },
    { label: "Orders", value: t.orders.toLocaleString("en-GB"), sub: `${t.ordersInvoiced} invoiced · COGS ${pct(tr.cogsPct)}` },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{store ? store.name : "All stores"} · {monthLabel(month)}</h1>
          <p className="text-sm text-muted">
            Amounts in {cur}{store ? " (Google Ads account currency)" : ""}, excl. VAT, converted with each day&apos;s locked rate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex gap-2" action="/">
            <input type="hidden" name="month" value={month} />
            <select name="store" defaultValue={storeId ?? ""} className="input w-auto">
              <option value="">All stores ({BASE_CURRENCY})</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.reportingCurrency})</option>
              ))}
            </select>
            <button className="btn-ghost">Show</button>
          </form>
          <Link className="btn-ghost" href={qs(shiftMonth(month, -1), storeId)} aria-label="Previous month">←</Link>
          <Link className="btn-ghost" href={qs(shiftMonth(month, 1), storeId)} aria-label="Next month">→</Link>
          <form action={syncNow}>
            {storeId && <input type="hidden" name="id" value={storeId} />}
            <button className="btn">Sync now</button>
          </form>
        </div>
      </header>

      {(t.ordersMissingCogs > 0 || noAdDays > 0 || notInvoiced > 0 || syncErrors.length > 0 || stores.length === 0) && (
        <div className="space-y-1 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-text">
          {stores.length === 0 && (
            <p>No stores connected yet. <Link className="underline" href="/stores/new">Add your first store</Link>.</p>
          )}
          {t.ordersMissingCogs > 0 && (
            <p>
              ⚠ {t.ordersMissingCogs} order{t.ordersMissingCogs === 1 ? " has" : "s have"} products without a cost, so profit is overstated.{" "}
              <Link className="underline" href="/products?missing=1">Add costs</Link>
            </p>
          )}
          {notInvoiced > 0 && (
            <p>
              {notInvoiced} of {t.orders} orders aren&apos;t covered by a supplier invoice yet, so their cost of goods is the SKU-cost estimate.{" "}
              <Link className="underline" href="/daily">Daily check</Link> · <Link className="underline" href="/invoices">Upload invoices</Link>
            </p>
          )}
          {noAdDays > 0 && (
            <p>
              ⚠ {noAdDays} day{noAdDays === 1 ? "" : "s"} with orders but no ad spend entered.{" "}
              <Link className="underline" href="/ad-spend">Enter ad spend</Link>
            </p>
          )}
          {syncErrors.map((s) => (
            <p key={s.id}>⚠ {s.name} failed to sync: {s.lastSyncError}</p>
          ))}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="card px-4 py-3">
            <div className="text-xs text-muted">{k.label}</div>
            <div className={`num mt-1 text-xl font-semibold ${k.tone === "neg" ? "text-negative" : ""}`}>{k.value}</div>
            <div className="num mt-0.5 text-xs text-muted">{k.sub}</div>
          </div>
        ))}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">Daily profit</h2>
        <ProfitChart
          currency={cur}
          data={visibleDays.map((d) => ({ date: d.date, label: shortDate(d.date), profit: d.profit, revenue: d.revenue, adSpend: d.adSpend }))}
        />
      </section>

      <StoreBreakdown month={month} span={span} selected={storeId} stores={stores} link={(sp2) => qs(month, storeId, sp2)} />

      <section className="card overflow-x-auto">
        <SheetTable days={sheet.days} total={t} currency={cur} month={month} lastDay={lastDay} />
      </section>
    </div>
  );
}

function SheetTable({ days, total, currency, month, lastDay }: { days: DayRow[]; total: DayRow; currency: string; month: string; lastDay: string }) {
  const cols = ["Date", "Gross revenue", "Refunds", "Revenue", "Cost of goods", "Ad spend", "Media buyer fee", "Transaction fees", "Profit", "ROAS", "Gross ROAS", "Profit %", "COG %", "POAS"];
  const row = (d: DayRow, label: string, isTotal = false) => {
    const r = ratios(d);
    const empty = !isTotal && d.date > lastDay;
    const m = (n: number) => (empty ? "" : money(n, currency));
    return (
      <tr key={label} className={isTotal ? "bg-accent-soft font-semibold" : empty ? "text-muted" : ""}>
        <td className="text-left">{label}</td>
        <td>{m(d.gross)}</td>
        <td>{m(d.refunds)}</td>
        <td>{m(d.revenue)}</td>
        <td>{m(d.cogs)}{!empty && d.ordersMissingCogs > 0 && <span title={`${d.ordersMissingCogs} orders missing a cost`} className="ml-1 text-warn-text">⚠</span>}</td>
        <td>{m(d.adSpend)}</td>
        <td>{m(d.mediaFee)}</td>
        <td>{m(d.fees)}</td>
        <td className={`font-semibold ${d.profit < 0 ? "text-negative" : ""}`}>{m(d.profit)}</td>
        <td>{empty ? "" : ratio(r.roas)}</td>
        <td>{empty ? "" : ratio(r.grossRoas)}</td>
        <td>{empty ? "" : pct(r.profitPct)}</td>
        <td>{empty ? "" : pct(r.cogsPct)}</td>
        <td>{empty ? "" : ratio(r.poas)}</td>
      </tr>
    );
  };
  return (
    <table className="table num [&_td]:text-right [&_th]:text-right [&_th:first-child]:text-left">
      <thead>
        <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {days.map((d) => row(d, new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC" })))}
        {row(total, monthLabel(month).split(" ")[0].toUpperCase(), true)}
      </tbody>
    </table>
  );
}

const SPANS = { month: "This month", ytd: "Year to date", all: "All time" } as const;

/** Profit or loss per store and for the whole business, all in the base currency so stores add up. */
async function StoreBreakdown({ month, span, selected, stores, link }: {
  month: string;
  span: keyof typeof SPANS;
  selected?: number;
  stores: Awaited<ReturnType<typeof listStores>>;
  link: (span: keyof typeof SPANS) => string;
}) {
  let { from, to } = monthRange(month);
  if (span === "ytd") ({ from, to } = { from: `${month.slice(0, 4)}-01-01`, to: to < today() ? to : today() });
  if (span === "all") {
    const [r] = await readOnlyQuery(`select least((select min(order_date) from orders), (select min(date) from ad_spend))::text as first`);
    from = r?.first ? String(r.first) : today();
    to = today();
  }
  const rows = await Promise.all(stores.map(async (s) => ({ store: s, t: (await buildSheet({ storeId: s.id, from, to, inBase: true })).total })));
  const sum = (await buildSheet({ from, to })).total; // includes ad spend not tied to a store
  const line = (key: string | number, label: React.ReactNode, d: DayRow, cls = "") => {
    const r = ratios(d);
    return (
      <tr key={key} className={cls}>
        <td className="text-left">{label}</td>
        <td>{d.orders.toLocaleString("en-GB")}</td>
        <td>{money(d.revenue, BASE_CURRENCY)}</td>
        <td>{money(d.cogs, BASE_CURRENCY)}<span className="ml-1 text-xs text-muted">{d.orders ? `${Math.round((d.ordersInvoiced / d.orders) * 100)}% inv.` : ""}</span></td>
        <td>{money(d.adSpend + d.mediaFee, BASE_CURRENCY)}</td>
        <td>{money(d.fees, BASE_CURRENCY)}</td>
        <td className={`font-semibold ${d.profit < 0 ? "text-negative" : "text-positive"}`}>{money(d.profit, BASE_CURRENCY)}</td>
        <td>{pct(r.profitPct)}</td>
        <td>{ratio(r.roas)}</td>
        <td>{ratio(r.poas)}</td>
      </tr>
    );
  };
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-sm font-medium">Profit / loss by store ({BASE_CURRENCY}) · {from} to {to}</h2>
        <div className="flex gap-1">
          {(Object.keys(SPANS) as (keyof typeof SPANS)[]).map((k) => (
            <Link key={k} href={link(k)} className={`rounded-md px-2 py-1 text-xs ${k === span ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"}`}>{SPANS[k]}</Link>
          ))}
        </div>
      </div>
      <table className="table num [&_td]:text-right [&_th]:text-right [&_th:first-child]:text-left">
        <thead>
          <tr><th>Store</th><th>Orders</th><th>Revenue</th><th>Cost of goods</th><th>Ads + media fee</th><th>Transaction fees</th><th>Profit / loss</th><th>Profit %</th><th>ROAS</th><th>POAS</th></tr>
        </thead>
        <tbody>
          {rows.map(({ store, t }) =>
            line(store.id, <Link className="font-medium hover:underline" href={`/?month=${month}&store=${store.id}`}>{store.name}</Link>, t, store.id === selected ? "bg-accent-soft" : ""),
          )}
          {line("total", "Whole business", sum, "border-t-2 border-border font-semibold")}
        </tbody>
      </table>
    </section>
  );
}
