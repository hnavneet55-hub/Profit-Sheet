import "server-only";
import { readOnlyQuery } from "@/db";
import { daysBetween } from "./dates";
import { sheetCogsUntil } from "./report";

export type DayStatus = {
  orders: number; // not cancelled
  invoiced: number; // of those, covered by an approved supplier invoice
  awaiting: number; // not invoiced yet, but matched on an uploaded invoice nobody has applied
  missingCost: number; // not invoiced and some product has no SKU cost
  adSpend: number; // in the ad account currency (summed; one account per store is assumed)
  adCurrency: string | null;
  adRows: number;
  adNoCpc: number; // ad spend rows with an amount but no CPC
  refunds: number;
  sheetCogs: boolean; // the old profit sheet has a cost for this day
  dayWise: boolean; // up to the end of the old sheet: costed per day, so no invoices are expected
};

const blank = (): DayStatus => ({ orders: 0, invoiced: 0, awaiting: 0, missingCost: 0, adSpend: 0, adCurrency: null, adRows: 0, adNoCpc: 0, refunds: 0, sheetCogs: false, dayWise: false });

/** What has been entered for each store on each day: `status.get(storeId)!.get(date)`. */
export async function dailyStatus(storeIds: number[], from: string, to: string): Promise<Map<number, Map<string, DayStatus>>> {
  const days = daysBetween(from, to);
  const out = new Map(storeIds.map((id) => [id, new Map(days.map((d) => [d, blank()]))]));
  const cell = (storeId: unknown, date: unknown) => out.get(Number(storeId))?.get(String(date));
  // readOnlyQuery takes plain SQL, so the dates are checked before being inlined.
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("Invalid date");
  const range = `between '${from}' and '${to}'`;

  for (const r of await readOnlyQuery(`
    select store_id, order_date::text as d, count(*) as orders,
      count(*) filter (where cogs_source = 'invoice') as invoiced,
      count(*) filter (where cogs_source <> 'invoice' and cogs_missing) as missing
    from orders where not cancelled and order_date ${range} group by 1, 2`)) {
    const c = cell(r.store_id, r.d);
    if (!c) continue;
    c.orders = Number(r.orders);
    c.invoiced = Number(r.invoiced);
    c.missingCost = Number(r.missing);
  }
  for (const r of await readOnlyQuery(`
    select o.store_id, o.order_date::text as d, count(distinct o.id) as n
    from invoice_orders io
    join supplier_invoices i on i.id = io.invoice_id
    join orders o on o.id = io.order_id
    where i.status = 'pending' and io.status = 'pending' and not o.cancelled and o.cogs_source <> 'invoice' and o.order_date ${range}
    group by 1, 2`)) {
    const c = cell(r.store_id, r.d);
    if (c) c.awaiting = Number(r.n);
  }
  for (const r of await readOnlyQuery(`
    select store_id, date::text as d, sum(amount) as amount, min(currency) as currency, count(*) as n,
      count(*) filter (where amount > 0 and (cpc is null or cpc <= 0)) as no_cpc
    from ad_spend where store_id is not null and date ${range} group by 1, 2`)) {
    const c = cell(r.store_id, r.d);
    if (!c) continue;
    c.adSpend = Number(r.amount);
    c.adCurrency = String(r.currency);
    c.adRows = Number(r.n);
    c.adNoCpc = Number(r.no_cpc);
  }
  for (const r of await readOnlyQuery(`
    select store_id, date::text as d from sheet_days where cogs is not null and date ${range}`)) {
    const c = cell(r.store_id, r.d);
    if (c) c.sheetCogs = true;
  }
  const until = await sheetCogsUntil();
  for (const [storeId, cells] of out) {
    const u = until.get(storeId);
    if (u) for (const [d, c] of cells) c.dayWise = d <= u;
  }
  for (const r of await readOnlyQuery(`
    select store_id, refund_date::text as d, count(*) as n from refunds where refund_date ${range} group by 1, 2`)) {
    const c = cell(r.store_id, r.d);
    if (c) c.refunds = Number(r.n);
  }
  return out;
}

export type StoreTodo = {
  adDays: { date: string; orders: number }[]; // days with no ad spend entered, from the store's first order or ad spend on
  cpcRows: { id: number; date: string; amount: number; currency: string }[]; // ad spend entered without a CPC
  orders: number; // orders costed one by one (after the old sheet ends)
  notInvoiced: number; // of those, not on a supplier invoice yet
  awaiting: number; // of those, matched on an uploaded invoice that hasn't been applied
  invoiceDays: { date: string; orders: number; notInvoiced: number; awaiting: number; missingCost: number }[]; // days with orders still to invoice, newest first
  missingCost: number; // of those, with no cost at all (within the missing-cost window)
  pending: { id: number; label: string; matched: number; dates: string }[]; // invoices read but not applied yet; matched orders and their date span
  count: number; // things to do, for the store tabs
};

/** What's left to enter for each store between `from` and `to`. */
export async function storeTodos(storeIds: number[], from: string, to: string, missingFrom: string): Promise<Map<number, StoreTodo>> {
  const status = await dailyStatus(storeIds, from, to);
  const ids = storeIds.length ? storeIds.join(",") : "0";
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("Invalid date");
  const range = `between '${from}' and '${to}'`;
  const first = new Map(
    (await readOnlyQuery(`
      select store_id, min(d)::text as d from (
        select store_id, min(order_date) d from orders group by 1
        union all select store_id, min(date) from ad_spend where store_id is not null group by 1
      ) x group by 1`)).map((r) => [Number(r.store_id), String(r.d)]),
  );
  const cpcRows = await readOnlyQuery(`
    select id, store_id, date::text as d, amount, currency from ad_spend
    where store_id in (${ids}) and date ${range} and amount > 0 and (cpc is null or cpc <= 0) order by date`);
  const pending = await readOnlyQuery(`
    select i.id, i.store_id, coalesce(i.supplier, i.filename, 'Invoice #' || i.id) as label,
      count(distinct io.order_id) as matched, min(o.order_date)::text as first, max(o.order_date)::text as last
    from supplier_invoices i
    left join invoice_orders io on io.invoice_id = i.id and io.status = 'pending'
    left join orders o on o.id = io.order_id
    where i.status = 'pending' and i.store_id in (${ids})
    group by i.id order by i.created_at`);
  const out = new Map<number, StoreTodo>();
  for (const id of storeIds) {
    const start = first.get(id);
    const cells = [...status.get(id)!.entries()];
    const after = cells.filter(([, c]) => !c.dayWise);
    const t: StoreTodo = {
      adDays: start ? cells.filter(([d, c]) => d >= start && c.adRows === 0).map(([date, c]) => ({ date, orders: c.orders })) : [],
      cpcRows: cpcRows.filter((r) => Number(r.store_id) === id).map((r) => ({ id: Number(r.id), date: String(r.d), amount: Number(r.amount), currency: String(r.currency) })),
      orders: after.reduce((n, [, c]) => n + c.orders, 0),
      notInvoiced: after.reduce((n, [, c]) => n + c.orders - c.invoiced, 0),
      awaiting: after.reduce((n, [, c]) => n + c.awaiting, 0),
      missingCost: after.reduce((n, [d, c]) => n + (d >= missingFrom ? c.missingCost : 0), 0),
      invoiceDays: after
        .filter(([, c]) => c.orders > c.invoiced)
        .map(([date, c]) => ({ date, orders: c.orders, notInvoiced: c.orders - c.invoiced, awaiting: c.awaiting, missingCost: date >= missingFrom ? c.missingCost : 0 }))
        .reverse(),
      pending: pending
        .filter((r) => Number(r.store_id) === id)
        .map((r) => ({ id: Number(r.id), label: String(r.label), matched: Number(r.matched), dates: r.first ? (r.first === r.last ? String(r.first) : `${r.first} to ${r.last}`) : "" })),
      count: 0,
    };
    t.count = t.adDays.length + t.cpcRows.length + t.pending.length + t.invoiceDays.length;
    out.set(id, t);
  }
  return out;
}
