import Link from "next/link";
import { adStats, buildSheet, ratios, type DayRow } from "@/lib/report";
import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { today } from "@/lib/dates";
import { money, pct, ratio, monthLabel } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function parseMonth(v: unknown) {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : today().slice(0, 7);
}

export type Kpi = { label: string; value: string; sub: string; tone?: "pos" | "neg" };

export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className={`card px-4 py-3 ${k.tone === "neg" ? "kpi-neg" : k.tone === "pos" ? "kpi-pos" : ""}`}>
          <div className="text-xs font-medium text-muted">{k.label}</div>
          <div className={`num mt-1 text-xl font-semibold ${k.tone === "neg" ? "text-negative" : k.tone === "pos" ? "text-positive" : ""}`}>{k.value}</div>
          <div className="num mt-0.5 text-xs text-muted">{k.sub}</div>
        </div>
      ))}
    </section>
  );
}

export function SheetTable({ days, total, currency, month, lastDay, withExpenses, costCutoff, missingCost }: { days: DayRow[]; total: DayRow; currency: string; month: string; lastDay: string; withExpenses: boolean; costCutoff: string; missingCost: number }) {
  const cols = ["Date", "Gross revenue", "Refunds", "Refund %", "Revenue", "Cost of goods", "Ad spend", "Media buyer fee", "Transaction fees", ...(withExpenses ? ["Business expenses"] : []), "Profit", "ROAS", "Gross ROAS", "Profit %", "COG %", "POAS", "CPC", "CVR %"];
  const row = (d: DayRow, label: string, isTotal = false) => {
    const r = ratios(d);
    const a = adStats(d);
    const empty = !isTotal && d.date > lastDay;
    const m = (n: number) => (empty ? "" : money(n, currency));
    return (
      <tr key={label} className={isTotal ? "total-row font-semibold" : empty ? "text-muted" : ""}>
        <td className="text-left">{label}</td>
        <td>{m(d.gross)}</td>
        <td className={d.refunds > 0 && !empty ? "text-negative" : ""}>{m(d.refunds)}</td>
        <td className={!empty && (r.refundPct ?? 0) >= 0.1 ? "text-negative" : ""}>{empty || !d.gross ? "" : pct(r.refundPct)}</td>
        <td>{m(d.revenue)}</td>
        <td>{m(d.cogs)}{!empty && d.ordersSheetCogs > 0 && !isTotal && <span title="Cost of goods from the old profit sheet" className="ml-1 text-xs text-muted">sheet</span>}{!empty && d.ordersMissingCogs > 0 && (isTotal ? missingCost > 0 : d.date >= costCutoff) && <span title={`${isTotal ? missingCost : d.ordersMissingCogs} orders without any cost`} className="ml-1 text-warn-text">⚠</span>}</td>
        <td>{m(d.adSpend)}</td>
        <td>{m(d.mediaFee)}</td>
        <td>{m(d.fees)}</td>
        {withExpenses && <td>{d.expenses ? m(d.expenses) : ""}</td>}
        <td className={`font-semibold ${empty ? "" : d.profit < 0 ? "text-negative" : d.profit > 0 ? "text-positive" : ""}`}>{m(d.profit)}</td>
        <td>{empty ? "" : ratio(r.roas)}</td>
        <td>{empty ? "" : ratio(r.grossRoas)}</td>
        <td>{empty ? "" : pct(r.profitPct)}</td>
        <td>{empty ? "" : pct(r.cogsPct)}</td>
        <td>{empty ? "" : ratio(r.poas)}</td>
        <td>{empty || a.cpc == null ? (!empty && d.adSpend > 0 ? <span className="text-warn-text" title="Enter the CPC with the ad spend">—</span> : "") : money(a.cpc, currency)}</td>
        <td title="Orders ÷ clicks">{empty || a.cvr == null ? "" : pct(a.cvr)}</td>
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

export const SPANS = { month: "This month", ytd: "Year to date", all: "All time" } as const;

/** Profit or loss per store and for the whole business, all in the base currency so stores add up. */
export async function StoreBreakdown({ month, span, stores, link }: {
  month: string;
  span: keyof typeof SPANS;
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
        <td>{pct(r.refundPct)}</td>
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
          <tr><th>Store</th><th>Orders</th><th>Revenue</th><th>Refund %</th><th>Cost of goods</th><th>Ads + media fee</th><th>Transaction fees</th><th>Profit / loss</th><th>Profit %</th><th>ROAS</th><th>POAS</th></tr>
        </thead>
        <tbody>
          {rows.map(({ store, t }) =>
            line(store.id, <Link className="font-medium text-accent hover:underline" href={`/?month=${month}&store=${store.id}`}>{store.name}</Link>, t),
          )}
          {sum.expenses > 0 && (
            <tr>
              <td className="text-left">Business expenses <Link href="/expenses" className="text-xs text-muted underline">details</Link></td>
              <td colSpan={6}></td>
              <td className="text-negative">−{money(sum.expenses, BASE_CURRENCY)}</td>
              <td colSpan={3}></td>
            </tr>
          )}
          {line("total", "Whole business", sum, "total-row border-t-2 border-border font-semibold")}
        </tbody>
      </table>
    </section>
  );
}
