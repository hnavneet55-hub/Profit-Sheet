import "server-only";
import { readOnlyQuery } from "@/db";

export type ChargebackStats = {
  /** Orders paid through Shopify Payments, the only ones Shopify reports disputes for. */
  paymentsOrders: number;
  chargebacks: number;
  lost: number;
  open: number;
  inquiries: number;
  /** chargebacks ÷ Shopify Payments orders, or null when the store has none. */
  rate: number | null;
  /** Share of the store's orders that went through Shopify Payments. */
  coverage: number | null;
};

/** Chargebacks of the orders placed in the period (one store, or all when storeId is null). */
export async function chargebackStats(storeId: number | null, from: string, to: string): Promise<ChargebackStats> {
  const [r] = await readOnlyQuery(`
    select count(*)::int as orders,
      count(*) filter (where gateways like '%shopify_payments%')::int as payments,
      count(*) filter (where chargeback)::int as chargebacks,
      count(*) filter (where chargeback_status = 'LOST')::int as lost,
      count(*) filter (where chargeback_status in ('NEEDS_RESPONSE', 'UNDER_REVIEW'))::int as open,
      count(*) filter (where inquiry and not chargeback)::int as inquiries
    from orders
    where not cancelled and order_date between '${from}' and '${to}' ${storeId ? `and store_id = ${Number(storeId)}` : ""}`);
  const orders = Number(r.orders), payments = Number(r.payments), chargebacks = Number(r.chargebacks);
  return {
    paymentsOrders: payments,
    chargebacks,
    lost: Number(r.lost),
    open: Number(r.open),
    inquiries: Number(r.inquiries),
    rate: payments ? chargebacks / payments : null,
    coverage: orders ? payments / orders : null,
  };
}

/** The KPI card text: the rate where Shopify can tell, otherwise why not. */
export function chargebackKpi(c: ChargebackStats): { value: string; sub: string; tone?: "neg" } {
  if (!c.paymentsOrders) return { value: "n/a", sub: "no Shopify Payments orders: Shopify doesn't report disputes" };
  const extra = [c.lost ? `${c.lost} lost` : "", c.open ? `${c.open} open` : "", c.inquiries ? `${c.inquiries} inquiries` : ""].filter(Boolean).join(" · ");
  return {
    value: `${((c.rate ?? 0) * 100).toFixed(2)}%`,
    sub: `${c.chargebacks} of ${c.paymentsOrders} Shopify Payments orders${extra ? ` · ${extra}` : ""}`,
    // Card networks start monitoring around 0.65-0.9%.
    tone: (c.rate ?? 0) >= 0.0065 ? "neg" : undefined,
  };
}
