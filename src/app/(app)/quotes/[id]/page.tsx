import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, readOnlyQuery, schema } from "@/db";
import { money, pct } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";
import { reviewQuote } from "../../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function QuotePage(props: PageProps<"/quotes/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const [q] = await db.select().from(schema.quoteImports).where(eq(schema.quoteImports.id, Number(id)));
  if (!q) notFound();
  const items = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.importId, q.id)).orderBy(asc(schema.quoteItems.id));
  const skus = (await readOnlyQuery(`select sku from order_lines union select sku from product_costs order by 1`)).map((r) => String(r.sku));
  const reviewing = q.status === "pending";

  return (
    <div className="space-y-5">
      <header>
        <Link href="/quotes" className="text-sm text-muted hover:text-text">← Supplier quotes</Link>
        <h1 className="mt-1 text-xl font-semibold">{q.supplier ?? q.filename ?? `Quote #${q.id}`}</h1>
        <p className="text-sm text-muted">
          Uploaded · {q.createdAt.toLocaleString("en-GB")}
          {q.filename && ` · ${q.filename}`}
        </p>
        {q.summary && <p className="mt-2 text-sm">{q.summary}</p>}
        {q.error && <p className="mt-2 text-sm text-negative">{q.error}</p>}
      </header>

      {items.length > 0 && (
        <form action={reviewQuote} className="space-y-4">
          <input type="hidden" name="importId" value={q.id} />
          <div className="card overflow-x-auto">
            <table className="table num">
              <thead>
                <tr><th>{reviewing ? "Apply" : "Status"}</th><th>Supplier wrote</th><th>Our SKU</th><th className="text-right">Unit cost</th><th>From</th><th className="text-right">Current ({BASE_CURRENCY})</th><th className="text-right">New ({BASE_CURRENCY})</th><th className="text-right">Change</th><th>Check</th></tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const change = it.previousCostBase && it.newCostBase != null ? (it.newCostBase - it.previousCostBase) / it.previousCostBase : null;
                  return (
                    <tr key={it.id} className="align-top">
                      <td>
                        {reviewing && it.status === "pending" ? (
                          <input type="checkbox" name="approve" value={it.id} defaultChecked={!!it.sku && it.flags.length === 0} aria-label={`Apply ${it.supplierRef}`} />
                        ) : (
                          <span className={it.status === "approved" ? "text-accent" : "text-muted"}>{it.status}</span>
                        )}
                      </td>
                      <td className="max-w-xs truncate" title={it.supplierRef ?? ""}>{it.supplierRef}</td>
                      <td>
                        {reviewing && it.status === "pending" ? (
                          <select name={`sku_${it.id}`} defaultValue={it.sku ?? ""} className="input w-44 font-mono text-xs">
                            <option value="">— pick SKU —</option>
                            {skus.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <span className="font-mono text-xs">{it.sku ?? "—"}</span>
                        )}
                      </td>
                      <td className="text-right">{money(it.unitCost, it.currency)}</td>
                      <td>{it.effectiveFrom}</td>
                      <td className="text-right">{money(it.previousCostBase, BASE_CURRENCY)}</td>
                      <td className="text-right">{money(it.newCostBase, BASE_CURRENCY)}</td>
                      <td className={`text-right ${change != null && Math.abs(change) >= 0.15 ? "font-semibold text-warn-text" : ""}`}>{change == null ? "—" : `${change > 0 ? "+" : ""}${pct(change)}`}</td>
                      <td className="max-w-sm whitespace-normal text-xs text-warn-text">{it.flags.map((f, i) => <div key={i}>⚠ {f}</div>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {reviewing && (
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pendingLabel="Applying…" name="intent" value="apply">Apply ticked prices</SubmitButton>
              <SubmitButton pendingLabel="Rejecting…" name="intent" value="reject" variant="ghost">Reject all</SubmitButton>
              <p className="text-xs text-muted">Lines with a warning are unticked. Applying recalculates profit for every order with those SKUs on or after the start date.</p>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
