import Link from "next/link";
import { adStats, buildSheet, ratios } from "@/lib/report";
import { listStores } from "@/lib/stores";
import { addDays, today } from "@/lib/dates";
import { money, pct, ratio, monthLabel, shortDate } from "@/lib/format";
import { BASE_CURRENCY, MISSING_COST_DAYS } from "@/lib/config";
import { ProfitChart } from "@/components/profit-chart";
import { syncNow } from "../../actions";
import { Kpis, SheetTable, StoreBreakdown, monthRange, parseMonth, shiftMonth } from "../sheet-parts";

/** The owner's view: every store together in the base currency, after business expenses. */
export default async function BusinessPage(props: PageProps<"/business">) {
  const sp = await props.searchParams;
  const month = parseMonth(sp.month);
  const stores = await listStores();
  const { from, to } = monthRange(month);
  const sheet = await buildSheet({ from, to });
  const t = sheet.total;
  const tr = ratios(t);
  const ta = adStats(t);
  const lastDay = to < today() ? to : today();
  const visibleDays = sheet.days.filter((d) => d.date <= lastDay);
  const costCutoff = addDays(today(), -MISSING_COST_DAYS);
  const missingCost = visibleDays.reduce((n, d) => n + (d.date >= costCutoff ? d.ordersMissingCogs : 0), 0);
  const syncErrors = stores.filter((s) => s.active && s.lastSyncError);
  const span = sp.span === "ytd" || sp.span === "all" ? sp.span : "month";
  const qs = (m: string, sp2 = span) => `/business?month=${m}${sp2 !== "month" ? `&span=${sp2}` : ""}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Whole business · {monthLabel(month)}</h1>
          <p className="text-sm text-muted">All stores together in {BASE_CURRENCY}, excl. VAT, after business expenses. Each store&apos;s own sheet is under <Link className="underline" href="/">Store sheets</Link>.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn-ghost" href={qs(shiftMonth(month, -1))} aria-label="Previous month">←</Link>
          <Link className="btn-ghost" href={qs(shiftMonth(month, 1))} aria-label="Next month">→</Link>
          <form action={syncNow}><button className="btn">Sync all stores</button></form>
        </div>
      </header>

      {(missingCost > 0 || syncErrors.length > 0) && (
        <div className="alert-warn space-y-1 text-sm">
          {missingCost > 0 && <p>⚠ {missingCost} order{missingCost === 1 ? "" : "s"} this month {missingCost === 1 ? "has" : "have"} no cost of goods yet, so profit is overstated until the supplier invoices are uploaded. Each store&apos;s sheet shows what&apos;s missing.</p>}
          {syncErrors.map((s) => <p key={s.id}>⚠ {s.name} failed to sync: {s.lastSyncError}</p>)}
        </div>
      )}

      <Kpis
        items={[
          { label: "Revenue", value: money(t.revenue, BASE_CURRENCY), sub: `after ${money(t.refunds, BASE_CURRENCY)} refunds (${pct(tr.refundPct)})` },
          { label: "Net profit", value: money(t.profit, BASE_CURRENCY), sub: `after ${money(t.expenses, BASE_CURRENCY)} business expenses`, tone: t.profit < 0 ? "neg" : "pos" },
          { label: "Ad spend", value: money(t.adSpend, BASE_CURRENCY), sub: `+ ${money(t.mediaFee, BASE_CURRENCY)} media buyer fee` },
          { label: "ROAS", value: ratio(tr.roas), sub: `gross ${ratio(tr.grossRoas)} · CPC ${ta.cpc == null ? "—" : money(ta.cpc, BASE_CURRENCY)} · CVR ${pct(ta.cvr)}` },
          { label: "POAS", value: ratio(tr.poas), sub: "profit ÷ ad spend" },
          { label: "Orders", value: t.orders.toLocaleString("en-GB"), sub: `COGS ${pct(tr.cogsPct)} of gross` },
        ]}
      />

      <StoreBreakdown month={month} span={span} stores={stores} link={(sp2) => qs(month, sp2)} />

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">Daily profit, all stores</h2>
        <ProfitChart currency={BASE_CURRENCY} data={visibleDays.map((d) => ({ date: d.date, label: shortDate(d.date), profit: d.profit, revenue: d.revenue, adSpend: d.adSpend }))} />
      </section>

      <section className="card overflow-x-auto">
        <SheetTable days={sheet.days} total={t} currency={BASE_CURRENCY} month={month} lastDay={lastDay} withExpenses costCutoff={costCutoff} missingCost={missingCost} />
      </section>
    </div>
  );
}
