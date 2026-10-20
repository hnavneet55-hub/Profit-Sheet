import Link from "next/link";
import { readOnlyQuery } from "@/db";
import { loadCostIndex, costOn } from "@/lib/costs";
import { today } from "@/lib/dates";
import { money } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";
import { deleteCost, setCost } from "../../actions";

type Product = { sku: string; name: string | null; units: number; last_sold: string | null; missing_orders: number };

export default async function ProductsPage(props: PageProps<"/products">) {
  const sp = await props.searchParams;
  const onlyMissing = sp.missing === "1";
  const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
  const products = (await readOnlyQuery(`
    select s.sku,
      (select l.name from order_lines l where l.sku = s.sku group by l.name order by count(*) desc limit 1) as name,
      coalesce((select sum(l.quantity) from order_lines l join orders o on o.id = l.order_id where l.sku = s.sku and o.order_date >= current_date - 30), 0)::int as units,
      (select max(o.order_date)::text from order_lines l join orders o on o.id = l.order_id where l.sku = s.sku) as last_sold,
      (select count(distinct l.order_id) from order_lines l where l.sku = s.sku and l.unit_cost_base is null)::int as missing_orders
    from (select sku from order_lines union select sku from product_costs) s
    order by units desc, s.sku`)) as Product[];
  const index = await loadCostIndex();
  const date = today();
  const shown = products.filter(
    (p) => (!onlyMissing || p.missing_orders > 0) && (!q || p.sku.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Products &amp; costs</h1>
          <p className="text-sm text-muted">A cost applies from its start date onwards; older orders keep the cost that applied then.</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search SKU or name" className="input w-56" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="missing" value="1" defaultChecked={onlyMissing} /> Missing cost</label>
          <button className="btn-ghost">Filter</button>
        </form>
      </header>

      <div className="card overflow-x-auto">
        <table className="table num">
          <thead>
            <tr><th>SKU</th><th>Product</th><th className="text-right">Units (30d)</th><th>Current cost</th><th>Set new cost</th></tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const current = costOn(index, p.sku, date);
              const history = index.get(p.sku) ?? [];
              return (
                <tr key={p.sku} className="align-top">
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td className="max-w-xs truncate" title={p.name ?? ""}>{p.name}</td>
                  <td className="text-right">{p.units}</td>
                  <td>
                    {current ? (
                      <details>
                        <summary className="cursor-pointer">{money(current.unitCost, current.currency)} <span className="text-xs text-muted">since {current.effectiveFrom}</span></summary>
                        <ul className="mt-1 space-y-1 text-xs">
                          {[...history].reverse().map((h) => (
                            <li key={h.id} className="flex items-center gap-2">
                              <span>{h.effectiveFrom}: {money(h.unitCost, h.currency)}</span>
                              <span className="text-muted">{h.source}{h.sourceRef ? <> · <Link className="underline" href={`/quotes/${h.sourceRef}`}>quote</Link></> : null}</span>
                              <form action={deleteCost}>
                                <input type="hidden" name="id" value={h.id} />
                                <button className="text-muted hover:text-negative">remove</button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-warn-text">⚠ No cost{p.missing_orders ? ` · ${p.missing_orders} orders` : ""}</span>
                    )}
                  </td>
                  <td>
                    <form action={setCost} className="flex gap-1">
                      <input type="hidden" name="sku" value={p.sku} />
                      <input name="unitCost" inputMode="decimal" className="input w-20" placeholder="Cost" required />
                      <input name="currency" className="input w-16 uppercase" maxLength={3} defaultValue={current?.currency ?? BASE_CURRENCY} required />
                      <input name="effectiveFrom" type="date" className="input w-36" defaultValue={current ? date : "2000-01-01"} required />
                      <button className="btn-ghost">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={5} className="py-8 text-center text-muted">No products yet. They appear after the first store sync.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">A first cost defaults to starting on 2000-01-01, so it also covers all past orders.</p>
    </div>
  );
}
