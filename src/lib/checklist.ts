import "server-only";
import { readOnlyQuery } from "@/db";
import { daysBetween } from "./dates";
import { sheetCogsUntil } from "./report";

export type DayStatus = {
  orders: number; // not cancelled
  invoiced: number; // of those, covered by an approved supplier invoice
  missingCost: number; // not invoiced and some product has no SKU cost
  adSpend: number; // in the ad account currency (summed; one account per store is assumed)
  adCurrency: string | null;
  adRows: number;
  adNoCpc: number; // ad spend rows missing the CPC or the conversion rate
  refunds: number;
  sheetCogs: boolean; // the old profit sheet has a cost for this day
  dayWise: boolean; // up to the end of the old sheet: costed per day, so no invoices are expected
};

const blank = (): DayStatus => ({ orders: 0, invoiced: 0, missingCost: 0, adSpend: 0, adCurrency: null, adRows: 0, adNoCpc: 0, refunds: 0, sheetCogs: false, dayWise: false });

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
    select store_id, date::text as d, sum(amount) as amount, min(currency) as currency, count(*) as n,
      count(*) filter (where cpc is null or cpc <= 0 or cvr is null) as no_cpc
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
