import Link from "next/link";
import { adStats, buildSheet, ratios, type DayRow } from "@/lib/report";
import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { addDays, today } from "@/lib/dates";
import { money, pct, ratio, monthLabel, shortDate } from "@/lib/format";
import { BASE_CURRENCY, MISSING_COST_DAYS } from "@/lib/config";
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
  const ta = adStats(t);
  const lastDay = to < today() ? to : today();
  const visibleDays = sheet.days.filter((d) => d.date <= lastDay);
  const noAdDays = visibleDays.filter((d) => d.orders > 0 && d.adSpend === 0).length;
  const syncErrors = stores.filter((s) => s.active && s.lastSyncError);
  // Orders whose day takes its cost from the old profit sheet don't need an invoice.
  // Orders counted one by one (after the old sheet ends) with no cost at all: no invoice and no SKU cost. Older ones are ignored.
  const costCutoff = addDays(today(), -MISSING_COST_DAYS);
  const missingDays = visibleDays.filter((d) => d.ordersMissingCogs > 0 && d.date >= costCutoff);
  const missingCost = missingDays.reduce((n, d) => n + d.ordersMissingCogs, 0);
  // The rest of the not-invoiced orders use the SKU-cost estimate.
  const estimated = t.orders - t.ordersDayWise - t.ordersInvoiced - t.ordersMissingCogs;
  const span = sp.span === "ytd" || sp.span === "all" ? sp.span : "month";
  const qs = (m: string, s?: number, sp2 = span) => `/?month=${m}${s ? `&store=${s}` : ""}${sp2 !== "month" ? `&span=${sp2}` : ""}`;

  const kpis = [
    { label: "Revenue", value: money(t.revenue, cur), sub: `after ${money(t.refunds, cur)} refunds` },
    { label: storeId ? "Profit" : "Net profit", value: money(t.profit, cur), sub: storeId ? `${pct(tr.profitPct)} of gross` : `after ${money(t.expenses, cur)} business expenses`, tone: t.profit < 0 ? "neg" : undefined },
    { label: "Ad spend", value: money(t.adSpend, cur), sub: `+ ${money(t.mediaFee, cur)} media buyer fee` },
    { label: "ROAS", value: ratio(tr.roas), sub: `gross ${ratio(tr.grossRoas)} · CPC ${ta.cpc == null ? "—" : money(ta.cpc, cur)} · CVR ${pct(ta.cvr)}` },
    { label: "POAS", value: ratio(tr.poas), sub: "profit ÷ ad spend" },
    { label: "Orders", value: t.orders.toLocaleString("en-GB"), sub: `${[t.ordersDayWise && `${t.ordersDayWise} costed by day (old sheet)`, t.orders > t.ordersDayWise && `${t.ordersInvoiced} of ${t.orders - t.ordersDayWise} invoiced`].filter(Boolean).join(" · ")} · COGS ${pct(tr.cogsPct)}` },
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

      {(missingCost > 0 || noAdDays > 0 || estimated > 0 || syncErrors.length > 0 || stores.length === 0) && (
        <div className="space-y-1 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-text">
          {stores.length === 0 && (
            <p>No stores connected yet. <Link className="underline" href="/stores/new">Add your first store</Link>.</p>
          )}
          {missingCost > 0 && (
            <p>
              ⚠ {missingCost} order{missingCost === 1 ? "" : "s"} from {shortDate(missingDays[0].date)}
              {missingDays.length > 1 ? ` – ${shortDate(missingDays.at(-1)!.date)}` : ""} {missingCost === 1 ? "has" : "have"} no cost of goods yet: they&apos;re after the old profit sheet ends, so they&apos;re costed order by order, and there&apos;s no supplier invoice for them yet. Their cost counts as 0, so profit is overstated until the invoices are uploaded.{" "}
              <Link className="underline" href="/invoices">Upload invoices</Link> · <Link className="underline" href={`/orders?from=${missingDays[0].date}&to=${missingDays.at(-1)!.date}&missing=1${storeId ? `&store=${storeId}` : ""}`}>See the orders</Link>
            </p>
          )}
          {estimated > 0 && (
            <p>
              {estimated} of {t.orders} orders aren&apos;t covered by a supplier invoice yet, so their cost of goods is the SKU-cost estimate.{" "}
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
        <SheetTable days={sheet.days} total={t} currency={cur} month={month} lastDay={lastDay} withExpenses={!storeId} costCutoff={costCutoff} missingCost={missingCost} />
      </section>
    </div>
  );
}

function SheetTable({ days, total, currency, month, lastDay, withExpenses, costCutoff, missingCost }: { days: DayRow[]; total: DayRow; currency: string; month: string; lastDay: string; withExpenses: boolean; costCutoff: string; missingCost: number }) {
  const cols = ["Date", "Gross revenue", "Refunds", "Revenue", "Cost of goods", "Ad spend", "Media buyer fee", "Transaction fees", ...(withExpenses ? ["Business expenses"] : []), "Profit", "ROAS", "Gross ROAS", "Profit %", "COG %", "POAS", "CPC", "CVR %"];
  const row = (d: DayRow, label: string, isTotal = false) => {
    const r = ratios(d);
    const a = adStats(d);
    const empty = !isTotal && d.date > lastDay;
    const m = (n: number) => (empty ? "" : money(n, currency));
    return (
      <tr key={label} className={isTotal ? "bg-accent-soft font-semibold" : empty ? "text-muted" : ""}>
        <td className="text-left">{label}</td>
        <td>{m(d.gross)}</td>
        <td>{m(d.refunds)}</td>
        <td>{m(d.revenue)}</td>
        <td>{m(d.cogs)}{!empty && d.ordersSheetCogs > 0 && !isTotal && <span title="Cost of goods from the old profit sheet" className="ml-1 text-xs text-muted">sheet</span>}{!empty && d.ordersMissingCogs > 0 && (isTotal ? missingCost > 0 : d.date >= costCutoff) && <span title={`${isTotal ? missingCost : d.ordersMissingCogs} orders without any cost`} className="ml-1 text-warn-text">⚠</span>}</td>
        <td>{m(d.adSpend)}</td>
        <td>{m(d.mediaFee)}</td>
        <td>{m(d.fees)}</td>
        {withExpenses && <td>{d.expenses ? m(d.expenses) : ""}</td>}
        <td className={`font-semibold ${d.profit < 0 ? "text-negative" : ""}`}>{m(d.profit)}</td>
        <td>{empty ? "" : ratio(r.roas)}</td>
        <td>{empty ? "" : ratio(r.grossRoas)}</td>
        <td>{empty ? "" : pct(r.profitPct)}</td>
        <td>{empty ? "" : pct(r.cogsPct)}</td>
        <td>{empty ? "" : ratio(r.poas)}</td>
        <td>{empty || a.cpc == null ? (!empty && d.adSpend > 0 ? <span className="text-warn-text" title="Enter the CPC with the ad spend">—</span> : "") : money(a.cpc, currency)}</td>
        <td>{empty || a.cvr == null ? "" : pct(a.cvr)}{!empty && a.cvr != null && d.cvrCalculated && <span title="No conversion rate entered: orders ÷ clicks" className="ml-1 text-xs text-muted">calc</span>}</td>
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
        <td>{money(d.cogs, BASE_CURRENCY)}<span className="ml-1 text-xs text-muted">{d.orders > d.ordersDayWise ? `${Math.round((d.ordersInvoiced / (d.orders - d.ordersDayWise)) * 100)}% inv.` : d.orders ? "sheet" : ""}</span></td>
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
          {sum.expenses > 0 && (
            <tr>
              <td className="text-left">Business expenses <Link href="/expenses" className="text-xs text-muted underline">details</Link></td>
              <td colSpan={5}></td>
              <td className="text-negative">−{money(sum.expenses, BASE_CURRENCY)}</td>
              <td colSpan={3}></td>
            </tr>
          )}
          {line("total", "Whole business", sum, "border-t-2 border-border font-semibold")}
        </tbody>
      </table>
    </section>
  );
}
