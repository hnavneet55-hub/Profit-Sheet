import "server-only";
import { readOnlyQuery } from "@/db";
import { rateFromBase } from "./fx";
import { sheetCogsUntil } from "./report";

export type CogsOrder = {
  name: string;
  time: string; // HH:MM in the store's day
  products: string;
  soldFor: number; // what the customer paid, excl. VAT, incl. shipping, after discounts
  refunded: number;
  productCost: number | null; // supplier invoice split; null when not invoiced
  shippingCost: number | null;
  otherCost: number | null;
  cost: number; // the cost of goods the profit sheet uses for the order
  source: "invoice" | "estimate" | "missing";
};

export type CogsDay = {
  currency: string;
  orders: CogsOrder[];
  dayWise: boolean; // up to the end of the old profit sheet: costed per day, not per order
  sheetCogs: number | null; // the old sheet's cost of goods for the day, when dayWise
  soldFor: number;
  cost: number; // the day's cost of goods, as the profit sheet counts it
};

/** Every order of one store's day, with what the customer paid and what the supplier charged. */
export async function cogsDay(store: { id: number; reportingCurrency: string; timezone: string | null }, date: string): Promise<CogsDay> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  const tz = (store.timezone ?? "UTC").replace(/'/g, "");
  const rows = await readOnlyQuery(`
    select o.name, to_char(o.created_at at time zone '${tz}', 'HH24:MI') as t,
      o.net_revenue_base as sold, coalesce(o.cogs_base, 0) as cost, o.cogs_source, o.cogs_missing,
      coalesce((select sum(r.amount_base) from refunds r where r.order_id = o.id), 0) as refunded,
      (select string_agg(l.name || ' × ' || l.quantity, ', ' order by l.name) from order_lines l where l.order_id = o.id) as products,
      i.product_cost, i.shipping_cost, i.other_cost, i.amount_base
    from orders o
    left join lateral (
      select sum(io.product_cost) as product_cost, sum(io.shipping_cost) as shipping_cost, sum(io.other_cost) as other_cost, sum(io.amount_base) as amount_base
      from invoice_orders io where io.order_id = o.id and io.status = 'approved'
    ) i on true
    where o.store_id = ${Number(store.id)} and o.order_date = '${date}' and not o.cancelled
    order by o.created_at`);
  const [sheet] = await readOnlyQuery(`select cogs_base from sheet_days where store_id = ${Number(store.id)} and date = '${date}'`);
  const until = (await sheetCogsUntil()).get(store.id);
  const dayWise = until != null && date <= until;
  const k = await rateFromBase(store.reportingCurrency, date);

  const orders: CogsOrder[] = rows.map((r) => {
    const invoiced = r.cogs_source === "invoice" && r.amount_base != null;
    // The invoice lists its parts in the supplier's currency; split the converted total the same way.
    const parts = Number(r.product_cost) + Number(r.shipping_cost) + Number(r.other_cost);
    const part = (v: unknown) => (invoiced && parts > 0 ? (Number(v) / parts) * Number(r.amount_base) * k : null);
    return {
      name: String(r.name),
      time: String(r.t ?? ""),
      products: String(r.products ?? ""),
      soldFor: Number(r.sold) * k,
      refunded: Number(r.refunded) * k,
      productCost: part(r.product_cost),
      shippingCost: part(r.shipping_cost),
      otherCost: part(r.other_cost),
      cost: Number(r.cost) * k,
      source: invoiced ? "invoice" : r.cogs_missing ? "missing" : "estimate",
    };
  });
  const sheetCogs = sheet?.cogs_base != null ? Number(sheet.cogs_base) * k : null;
  const soldFor = orders.reduce((n, o) => n + o.soldFor, 0);
  const cost = dayWise && sheetCogs != null ? sheetCogs : orders.reduce((n, o) => n + o.cost, 0);
  return { currency: store.reportingCurrency, orders, dayWise, sheetCogs, soldFor, cost };
}
