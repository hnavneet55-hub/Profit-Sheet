import Link from "next/link";
import { adStats, buildSheet, ratios } from "@/lib/report";
import { listStores } from "@/lib/stores";
import { storeTodos, type StoreTodo } from "@/lib/checklist";
import { readOnlyQuery } from "@/db";
import { adsCheck } from "@/lib/ads-script";
import { addDays, today } from "@/lib/dates";
import { money, pct, ratio, monthLabel, shortDate } from "@/lib/format";
import { MISSING_COST_DAYS } from "@/lib/config";
import { ProfitChart } from "@/components/profit-chart";
import { SubmitButton } from "@/components/submit-button";
import { addAdSpend, setAdSpendCpc, syncNow, uploadInvoice } from "../actions";
import { Kpis, SheetTable, monthRange, parseMonth, shiftMonth } from "./sheet-parts";

// Reading a supplier invoice with Claude can take a couple of minutes.
export const maxDuration = 300;

// The checklist covers this many days up to yesterday (today's ad spend isn't final yet).
const TODO_DAYS = 30;

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

/** One store at a time: what's left to enter, then its profit sheet in its Google Ads currency. */
export default async function StoreSheetPage(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const month = parseMonth(sp.month);
  const stores = (await listStores()).filter((s) => s.active);
  if (!stores.length) {
    return <p className="text-sm text-muted">No stores connected yet. <Link className="underline" href="/stores/new">Add your first store</Link>.</p>;
  }
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const cur = store.reportingCurrency;

  const todoTo = addDays(today(), -1);
  const costCutoff = addDays(today(), -MISSING_COST_DAYS);
  const todos = await storeTodos(stores.map((s) => s.id), addDays(todoTo, -(TODO_DAYS - 1)), todoTo, costCutoff);
  const todo = todos.get(store.id)!;
  const i = stores.indexOf(store);
  const [ads] = await readOnlyQuery(`select max(received_at) as at from ads_reports where store_id = ${store.id}`);
  const adsAt = ads?.at ? new Date(String(ads.at)) : null;
  const adsDiffer = adsAt ? (await adsCheck(store.id)).filter((r) => !r.matches).length : 0;
  const next = [...stores.slice(i + 1), ...stores.slice(0, i)].find((s) => todos.get(s.id)!.count > 0);

  const { from, to } = monthRange(month);
  const sheet = await buildSheet({ storeId: store.id, from, to });
  const t = sheet.total;
  const tr = ratios(t);
  const ta = adStats(t);
  const lastDay = to < today() ? to : today();
  const visibleDays = sheet.days.filter((d) => d.date <= lastDay);
  const missingCost = visibleDays.reduce((n, d) => n + (d.date >= costCutoff ? d.ordersMissingCogs : 0), 0);
  const qs = (m: string, s = store.id) => `/?store=${s}&month=${m}`;

  return (
    <div className="space-y-5">
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Stores">
        {stores.map((s) => {
          const n = todos.get(s.id)!.count;
          const on = s.id === store.id;
          return (
            <Link key={s.id} href={qs(month, s.id)} className={`store-tab ${on ? "store-tab-on" : ""}`} aria-current={on ? "page" : undefined}>
              <span>{s.name}</span>
              <span className={`badge ${n ? "badge-warn" : "badge-ok"}`}>{n ? n : "✓"}</span>
            </Link>
          );
        })}
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{store.name}</h1>
          <p className="text-sm text-muted">Amounts in {cur} (the Google Ads account currency), excl. VAT. Orders, refunds, conversion rate and refund % come from Shopify automatically.</p>
        </div>
        <form action={syncNow}>
          <input type="hidden" name="id" value={store.id} />
          <SubmitButton variant="ghost" pendingLabel="Syncing…">Sync {store.name} now</SubmitButton>
        </form>
      </header>

      <Checklist store={store} todo={todo} adsAt={adsAt} adsDiffer={adsDiffer} next={next && { name: next.name, href: qs(month, next.id) }} />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h2 className="text-lg font-semibold">Profit sheet · {monthLabel(month)}</h2>
        <div className="flex gap-2">
          <Link className="btn-ghost" href={qs(shiftMonth(month, -1))} aria-label="Previous month">←</Link>
          <Link className="btn-ghost" href={qs(shiftMonth(month, 1))} aria-label="Next month">→</Link>
        </div>
      </div>

      <Kpis
        title="Sales & profit"
        items={[
          { label: "Revenue", value: money(t.revenue, cur), sub: `after ${money(t.refunds, cur)} refunds (${pct(tr.refundPct)})` },
          { label: "Profit", value: money(t.profit, cur), sub: `${pct(tr.profitPct)} of gross`, tone: t.profit < 0 ? "neg" : "pos" },
          { label: "Orders", value: t.orders.toLocaleString("en-GB"), sub: `COGS ${pct(tr.cogsPct)} of gross` },
          { label: "POAS", value: ratio(tr.poas), sub: "profit ÷ ad spend" },
        ]}
      />
      <Kpis
        title="Advertising"
        items={[
          { label: "Ad spend", value: money(t.adSpend, cur), sub: "from Google Ads" },
          { label: "Media buyer fee", value: money(t.mediaFee, cur), sub: `total ad cost ${money(t.adSpend + t.mediaFee, cur)}` },
          { label: "ROAS", value: ratio(tr.roas), sub: `gross ROAS ${ratio(tr.grossRoas)}` },
          { label: "CPC · CVR", value: ta.cpc == null ? "—" : money(ta.cpc, cur), sub: `CVR ${pct(ta.cvr)} (orders ÷ clicks)` },
        ]}
      />

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-medium">Daily profit</h2>
        <ProfitChart currency={cur} data={visibleDays.map((d) => ({ date: d.date, label: shortDate(d.date), profit: d.profit, revenue: d.revenue, adSpend: d.adSpend }))} />
      </section>

      <section className="card overflow-x-auto">
        <SheetTable days={sheet.days} total={t} currency={cur} month={month} lastDay={lastDay} withExpenses={false} costCutoff={costCutoff} missingCost={missingCost} dayHref={(d) => `/cogs?store=${store.id}&date=${d}`} />
      </section>
    </div>
  );
}

type Store = Awaited<ReturnType<typeof listStores>>[number];

/** The data-entry steps for one store, with the inputs right there. */
function Checklist({ store, todo, adsAt, adsDiffer, next }: { store: Store; todo: StoreTodo; adsAt: Date | null; adsDiffer: number; next?: { name: string; href: string } }) {
  const cur = store.reportingCurrency;
  const adLeft = todo.adDays.length + todo.cpcRows.length;
  const invLeft = todo.pending.length + todo.invoiceDays.length;

  if (todo.count === 0 && !store.lastSyncError) {
    return (
      <section className="alert-ok flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">✓ {store.name} is done: ad spend and supplier invoices are in for the last {TODO_DAYS} days.</p>
        {next ? <Link className="btn" href={next.href}>Next: {next.name} →</Link> : <span className="text-sm">All stores are done.</span>}
      </section>
    );
  }

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <Step n={1} title="Ad spend" left={adLeft} hint={adsAt ? `Automatic from Google Ads, last received ${adsAt.toLocaleString("en-GB")}.` : `From Google Ads, in ${cur}: the day's cost and the average CPC.`}>
        {adLeft === 0 && <p className="text-sm text-muted">Entered for every day.</p>}
        {adsDiffer > 0 && <Link className="block text-sm text-negative underline" href={`/ad-spend/script?store=${store.id}`}>⚠ {adsDiffer} day{adsDiffer === 1 ? "" : "s"} entered differ from Google Ads: check →</Link>}
        {!adsAt && <Link className="block text-xs text-accent underline" href={`/ad-spend/script?store=${store.id}`}>Make this automatic: connect Google Ads →</Link>}
        {todo.adDays.length > 0 && (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {todo.adDays.slice().reverse().map((d) => (
              <li key={d.date}>
                <form action={addAdSpend} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="storeId" value={store.id} />
                  <input type="hidden" name="currency" value={cur} />
                  <input type="hidden" name="date" value={d.date} />
                  <span className="num w-24 shrink-0 text-sm">{dayLabel(d.date)}<span className="block text-xs text-muted">{d.orders} order{d.orders === 1 ? "" : "s"}</span></span>
                  <input name="amount" className="input w-24" inputMode="decimal" placeholder={`Spend ${cur}`} aria-label={`Ad spend ${d.date}`} required />
                  <input name="cpc" className="input w-20" inputMode="decimal" placeholder="CPC" aria-label={`CPC ${d.date}`} required />
                  <SubmitButton pendingLabel="…">Save</SubmitButton>
                  <button name="noAds" value="1" formNoValidate className="text-xs text-muted hover:text-text" title="No ads ran this day">No ads</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {todo.cpcRows.length > 0 && (
          <ul className="space-y-2 border-t border-border pt-2">
            <li className="text-xs text-muted">Entered without a CPC:</li>
            {todo.cpcRows.map((r) => (
              <li key={r.id}>
                <form action={setAdSpendCpc} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <span className="num w-24 shrink-0 text-sm">{dayLabel(r.date)}</span>
                  <span className="num w-24 text-sm">{money(r.amount, r.currency)}</span>
                  <input name="cpc" className="input w-20" inputMode="decimal" placeholder="CPC" aria-label={`CPC ${r.date}`} required />
                  <SubmitButton pendingLabel="…">Save</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {todo.adDays.length > 3 && <Link className="text-xs text-accent underline" href={`/ad-spend?store=${store.id}`}>Paste many days at once</Link>}
      </Step>

      <Step n={2} title="Cost of goods" left={invLeft} hint="Upload each day's supplier invoice or export. One file can cover several days; every day it covers ticks off.">
        {todo.orders === 0 ? (
          <p className="text-sm text-muted">No orders to invoice: these days are costed from the old profit sheet.</p>
        ) : todo.notInvoiced === 0 ? (
          <p className="text-sm text-positive">✓ All {todo.orders} orders invoiced</p>
        ) : (
          <p className="text-sm text-muted">
            {todo.notInvoiced} of {todo.orders} orders on {todo.invoiceDays.length} day{todo.invoiceDays.length === 1 ? "" : "s"} aren&apos;t on an invoice yet; their cost of goods is an estimate until then.
            {todo.missingCost > 0 && <span className="block text-negative">⚠ {todo.missingCost} of them have no cost at all, so profit is overstated.</span>}
          </p>
        )}
        {todo.invoiceDays.length > 0 && (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {todo.invoiceDays.map((d) => (
              <li key={d.date} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                  <Link className="num font-medium hover:underline" href={`/cogs?store=${store.id}&date=${d.date}`} title="See this day's orders and cost of goods">{dayLabel(d.date)}</Link>
                  <Link className="text-xs text-warn-text hover:underline" href={`/orders?store=${store.id}&from=${d.date}&to=${d.date}&invoiced=0`}>
                    {d.notInvoiced === d.orders ? `${d.orders} order${d.orders === 1 ? "" : "s"}, none invoiced` : `${d.notInvoiced} of ${d.orders} orders not invoiced`}
                    {d.missingCost > 0 && <span className="text-negative"> · {d.missingCost} no cost</span>}
                  </Link>
                </div>
                <form action={uploadInvoice} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="storeId" value={store.id} />
                  <input type="hidden" name="text" value={`Supplier invoice for ${store.name}'s orders of ${d.date}.`} />
                  <input type="file" name="file" required accept=".pdf,application/pdf,.xlsx,.xls,.xlsm,.csv,.ods,image/png,image/jpeg,image/webp" className="input min-w-0 flex-1 py-1 text-xs" aria-label={`Invoice for ${d.date}`} />
                  <SubmitButton pendingLabel="Reading…">Upload</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {todo.pending.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-2 text-sm">
            <li className="text-xs text-muted">Read, waiting for you to check and approve:</li>
            {todo.pending.map((p) => (
              <li key={p.id}><Link className="text-accent underline" href={`/invoices/${p.id}`}>Review {p.label} →</Link></li>
            ))}
          </ul>
        )}
      </Step>

      <Step n={3} title="Orders & refunds" left={store.lastSyncError ? 1 : 0} hint="Nothing to enter: synced from Shopify every hour.">
        {store.lastSyncError ? (
          <p className="text-sm text-negative">⚠ Sync failed: {store.lastSyncError}. <Link className="underline" href={`/stores/${store.id}`}>Check the store settings</Link></p>
        ) : (
          <p className="text-sm text-muted">Last synced {store.lastSyncedAt ? store.lastSyncedAt.toLocaleString("en-GB") : "never"}.</p>
        )}
        {todo.count === 0 && next && <Link className="btn" href={next.href}>Next: {next.name} →</Link>}
      </Step>
    </section>
  );
}

function Step({ n, title, left, hint, children }: { n: number; title: string; left: number; hint: string; children: React.ReactNode }) {
  return (
    <div className={`card step space-y-3 p-4 ${left ? "step-todo" : "step-done"}`}>
      <div className="flex items-center gap-2">
        <span className={`step-num ${left ? "" : "step-num-done"}`}>{left ? n : "✓"}</span>
        <h3 className="font-medium">{title}</h3>
        {left > 0 && <span className="badge badge-warn ml-auto">{left} to do</span>}
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {children}
    </div>
  );
}
