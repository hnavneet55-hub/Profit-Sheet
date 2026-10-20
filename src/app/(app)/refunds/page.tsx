import { readOnlyQuery } from "@/db";
import { addDays, today } from "@/lib/dates";
import { money } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";

type Refund = {
  id: string; order_name: string; store: string; order_date: string; refund_date: string; days_after: number;
  amount: number; currency: string; amount_base: number; products: string | null; first_seen_at: string;
};
type ProductReturns = { sku: string; name: string; units: number; refunds: number; sold: number };

export default async function RefundsPage(props: PageProps<"/refunds">) {
  const sp = await props.searchParams;
  const days = Number(sp.days) || 30;
  const from = addDays(today(), -(days - 1));
  const refunds = (await readOnlyQuery(`
    select r.id, o.name as order_name, s.name as store, o.order_date::text, r.refund_date::text,
      (r.refund_date - o.order_date) as days_after, r.amount, o.currency, r.amount_base, r.first_seen_at::text,
      (select string_agg(rl.quantity || '× ' || rl.name, ', ') from refund_lines rl where rl.refund_id = r.id) as products
    from refunds r join orders o on o.id = r.order_id join stores s on s.id = r.store_id
    where r.refund_date >= '${from}'
    order by r.created_at desc limit 500`)) as Refund[];
  const top = (await readOnlyQuery(`
    select rl.sku, max(rl.name) as name, sum(rl.quantity)::int as units, count(distinct rl.refund_id)::int as refunds,
      coalesce((select sum(l.quantity) from order_lines l join orders o on o.id = l.order_id where l.sku = rl.sku and o.order_date >= '${from}'), 0)::int as sold
    from refund_lines rl join refunds r on r.id = rl.refund_id
    where r.refund_date >= '${from}'
    group by rl.sku order by units desc limit 10`)) as ProductReturns[];
  const total = refunds.reduce((s, r) => s + Number(r.amount_base ?? 0), 0);
  // Refunds on orders from an earlier month change that month's numbers after the fact.
  const late = refunds.filter((r) => r.order_date.slice(0, 7) < r.refund_date.slice(0, 7));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Refunds</h1>
          <p className="text-sm text-muted">Every refund is pulled from Shopify automatically and counted on the day it was issued.</p>
        </div>
        <form className="flex gap-2">
          <select name="days" defaultValue={days} className="input w-auto">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button className="btn-ghost">Show</button>
        </form>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3"><div className="text-xs text-muted">Refunds</div><div className="num mt-1 text-xl font-semibold">{refunds.length}</div></div>
        <div className="card px-4 py-3"><div className="text-xs text-muted">Refunded (excl. VAT)</div><div className="num mt-1 text-xl font-semibold">{money(total, BASE_CURRENCY)}</div></div>
        <div className="card px-4 py-3"><div className="text-xs text-muted">On orders from an earlier month</div><div className="num mt-1 text-xl font-semibold">{late.length}</div></div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="px-3 pt-3 text-sm font-medium">Most refunded products</h2>
        <table className="table num">
          <thead><tr><th>SKU</th><th>Product</th><th className="text-right">Units refunded</th><th className="text-right">Refunds</th><th className="text-right">Units sold</th><th className="text-right">Refund rate</th></tr></thead>
          <tbody>
            {top.map((p) => (
              <tr key={p.sku}>
                <td className="font-mono text-xs">{p.sku}</td>
                <td className="max-w-xs truncate">{p.name}</td>
                <td className="text-right">{p.units}</td>
                <td className="text-right">{p.refunds}</td>
                <td className="text-right">{p.sold}</td>
                <td className="text-right">{p.sold ? `${((p.units / p.sold) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
            {!top.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No product-level refunds in this period.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <table className="table num">
          <thead><tr><th>Refund date</th><th>Order</th><th>Store</th><th>Order date</th><th className="text-right">Days after</th><th className="text-right">Amount</th><th className="text-right">{BASE_CURRENCY} excl. VAT</th><th>Products</th></tr></thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.id}>
                <td>{r.refund_date}</td>
                <td className="font-medium">{r.order_name}</td>
                <td>{r.store}</td>
                <td>{r.order_date}{r.order_date.slice(0, 7) < r.refund_date.slice(0, 7) && <span className="ml-1 rounded bg-warn-bg px-1 text-xs text-warn-text">earlier month</span>}</td>
                <td className="text-right">{r.days_after}</td>
                <td className="text-right">{money(Number(r.amount), r.currency)}</td>
                <td className="text-right">{money(Number(r.amount_base), BASE_CURRENCY)}</td>
                <td className="max-w-sm truncate text-muted" title={r.products ?? ""}>{r.products}</td>
              </tr>
            ))}
            {!refunds.length && <tr><td colSpan={8} className="py-8 text-center text-muted">No refunds in this period.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
