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

export function Kpis({ title, items }: { title?: string; items: Kpi[] }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className={`card px-4 py-3 ${k.tone === "neg" ? "kpi-neg" : k.tone === "pos" ? "kpi-pos" : ""}`}>
          <div className="text-xs font-medium text-muted">{k.label}</div>
          <div className={`num mt-1 text-xl font-semibold ${k.tone === "neg" ? "text-negative" : k.tone === "pos" ? "text-positive" : ""}`}>{k.value}</div>
          <div className="num mt-0.5 text-xs text-muted">{k.sub}</div>
        </div>
      ))}
      </div>
    </section>
  );
}

// Column sections of the daily sheet; advertising is kept apart from the other costs.
const GROUP_CLASS = { sales: "", costs: "grp-costs", ads: "grp-ads", result: "grp-result" } as const;

export function SheetTable({ days, total, currency, month, lastDay, withExpenses, costCutoff, missingCost, dayHref }: { days: DayRow[]; total: DayRow; currency: string; month: string; lastDay: string; withExpenses: boolean; costCutoff: string; missingCost: number; dayHref?: (date: string) => string }) {
  const groups: { key: keyof typeof GROUP_CLASS; label: string; cols: string[] }[] = [
    { key: "sales", label: "Sales", cols: ["Gross revenue", "Refunds", "Refund %", "Revenue"] },
    { key: "costs", label: "Costs", cols: ["Cost of goods", "COG %", "Transaction fees", ...(withExpenses ? ["Business expenses"] : [])] },
    { key: "ads", label: "Advertising", cols: ["Ad spend", "Media buyer fee", "CPC", "CVR %", "ROAS", "Gross ROAS"] },
    { key: "result", label: "Result", cols: ["Profit", "Profit %", "POAS"] },
  ];
  const row = (d: DayRow, label: string, isTotal = false) => {
    const r = ratios(d);
    const a = adStats(d);
    const empty = !isTotal && d.date > lastDay;
    const m = (n: number) => (empty ? "" : money(n, currency));
    const c = (g: keyof typeof GROUP_CLASS, first = false) => `${GROUP_CLASS[g]} ${first ? "grp-start" : ""}`;
    return (
      <tr key={label} className={isTotal ? "total-row font-semibold" : empty ? "text-muted" : ""}>
        <td className="text-left">{dayHref && !isTotal && !empty && d.orders > 0 ? <Link className="text-accent hover:underline" href={dayHref(d.date)} title="See this day's orders and cost of goods">{label}</Link> : label}</td>
        <td className="grp-start">{m(d.gross)}</td>
        <td className={d.refunds > 0 && !empty ? "text-negative" : ""}>{m(d.refunds)}</td>
        <td className={!empty && (r.refundPct ?? 0) >= 0.1 ? "text-negative" : ""}>{empty || !d.gross ? "" : pct(r.refundPct)}</td>
        <td>{m(d.revenue)}</td>
        <td className={c("costs", true)}>{m(d.cogs)}{!empty && d.ordersSheetCogs > 0 && !isTotal && <span title="Cost of goods from the old profit sheet" className="ml-1 text-xs text-muted">sheet</span>}{!empty && d.ordersMissingCogs > 0 && (isTotal ? missingCost > 0 : d.date >= costCutoff) && <span title={`${isTotal ? missingCost : d.ordersMissingCogs} orders without any cost`} className="ml-1 text-warn-text">⚠</span>}</td>
        <td className={c("costs")}>{empty ? "" : pct(r.cogsPct)}</td>
        <td className={c("costs")}>{m(d.fees)}</td>
        {withExpenses && <td className={c("costs")}>{d.expenses ? m(d.expenses) : ""}</td>}
        <td className={c("ads", true)}>{m(d.adSpend)}</td>
        <td className={c("ads")}>{m(d.mediaFee)}</td>
        <td className={c("ads")}>{empty || a.cpc == null ? (!empty && d.adSpend > 0 ? <span className="text-warn-text" title="Enter the CPC with the ad spend">—</span> : "") : money(a.cpc, currency)}</td>
        <td className={c("ads")} title="Orders ÷ clicks">{empty || a.cvr == null ? "" : pct(a.cvr)}</td>
        <td className={c("ads")}>{empty ? "" : ratio(r.roas)}</td>
        <td className={c("ads")}>{empty ? "" : ratio(r.grossRoas)}</td>
        <td className={`${c("result", true)} font-semibold ${empty ? "" : d.profit < 0 ? "text-negative" : d.profit > 0 ? "text-positive" : ""}`}>{m(d.profit)}</td>
        <td className={c("result")}>{empty ? "" : pct(r.profitPct)}</td>
        <td className={c("result")}>{empty ? "" : ratio(r.poas)}</td>
      </tr>
    );
  };
  return (
    <table className="table num [&_td]:text-right [&_th]:text-right [&_th:first-child]:text-left">
      <thead>
        <tr className="grp-head">
          <th></th>
          {groups.map((g) => <th key={g.key} colSpan={g.cols.length} className={`${GROUP_CLASS[g.key]} grp-start !text-center`}>{g.label}</th>)}
        </tr>
        <tr>
          <th>Date</th>
          {groups.flatMap((g) => g.cols.map((col, i) => <th key={col} className={`${GROUP_CLASS[g.key]} ${i === 0 ? "grp-start" : ""}`}>{col}</th>))}
        </tr>
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
        <td className="grp-ads grp-start">{money(d.adSpend, BASE_CURRENCY)}</td>
        <td className="grp-ads">{money(d.mediaFee, BASE_CURRENCY)}</td>
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
          <tr><th>Store</th><th>Orders</th><th>Revenue</th><th>Refund %</th><th>Cost of goods</th><th className="grp-ads grp-start">Ad spend</th><th className="grp-ads">Media buyer fee</th><th>Transaction fees</th><th>Profit / loss</th><th>Profit %</th><th>ROAS</th><th>POAS</th></tr>
        </thead>
        <tbody>
          {rows.map(({ store, t }) =>
            line(store.id, <Link className="font-medium text-accent hover:underline" href={`/?month=${month}&store=${store.id}`}>{store.name}</Link>, t),
          )}
          {sum.expenses > 0 && (
            <tr>
              <td className="text-left">Business expenses <Link href="/expenses" className="text-xs text-muted underline">details</Link></td>
              <td colSpan={7}></td>
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
