import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { money } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";
import { removeInvoice, reviewInvoice } from "../../../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function InvoicePage(props: PageProps<"/invoices/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const [inv] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, Number(id)));
  if (!inv) notFound();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, inv.storeId));
  const rows = await db
    .select({ r: schema.invoiceOrders, orderName: schema.orders.name, orderDate: schema.orders.orderDate })
    .from(schema.invoiceOrders)
    .leftJoin(schema.orders, eq(schema.invoiceOrders.orderId, schema.orders.id))
    .where(eq(schema.invoiceOrders.invoiceId, inv.id))
    .orderBy(asc(schema.invoiceOrders.id));
  const reviewing = inv.status === "pending";
  const unmatched = rows.filter(({ r }) => r.status === "pending" && !r.orderId).length;
  const approvedBase = rows.reduce((n, { r }) => n + (r.status === "approved" ? (r.amountBase ?? 0) : 0), 0);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <Link href="/invoices" className="text-sm text-muted hover:text-text">← Supplier invoices</Link>
        <h1 className="text-xl font-semibold">{inv.supplier ?? inv.filename ?? `Invoice #${inv.id}`}{inv.invoiceNumber && ` · ${inv.invoiceNumber}`}</h1>
        <p className="text-sm text-muted">
          For <span className="font-medium text-text">{store?.name}</span>
          {inv.storeOnInvoice && <> (invoice says “{inv.storeOnInvoice}”)</>}
          {inv.invoiceDate && ` · dated ${inv.invoiceDate}`}
          {inv.total != null && inv.currency && ` · total ${money(inv.total, inv.currency)}`}
          {` · uploaded ${inv.createdAt.toLocaleString("en-GB")}`}
          {inv.filename && ` · ${inv.filename}`}
        </p>
        {inv.summary && <p className="text-sm">{inv.summary}</p>}
        {inv.error && <p className="text-sm text-negative">{inv.error}</p>}
      </header>

      {inv.flags.length > 0 && (
        <div className="space-y-1 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-text">
          {inv.flags.map((f, i) => <p key={i}>⚠ {f}</p>)}
        </div>
      )}

      {rows.length > 0 && (
        <form action={reviewInvoice} className="space-y-4">
          <input type="hidden" name="invoiceId" value={inv.id} />
          <div className="card overflow-x-auto">
            <table className="table num [&_td.r]:text-right [&_th.r]:text-right">
              <thead>
                <tr>
                  <th>{reviewing ? "Apply" : "Status"}</th><th>Supplier wrote</th><th>Our order</th><th>Products</th>
                  <th className="r">Goods</th><th className="r">Shipping</th><th className="r">Other</th>
                  <th className="r">Total ({BASE_CURRENCY})</th><th className="r">Estimate ({BASE_CURRENCY})</th><th>Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, orderName, orderDate }) => (
                  <tr key={r.id} className="align-top">
                    <td>
                      {reviewing && r.status === "pending" ? (
                        <input type="checkbox" name="approve" value={r.id} disabled={!r.orderId} defaultChecked={!!r.orderId && r.flags.length === 0} aria-label={`Apply ${r.orderRef}`} />
                      ) : (
                        <span className={r.status === "approved" ? "text-accent" : "text-muted"}>{r.status}</span>
                      )}
                    </td>
                    <td>{r.orderRef}</td>
                    <td>
                      {r.orderId ? (
                        <span>{orderName} <span className="text-xs text-muted">{orderDate}</span></span>
                      ) : reviewing && r.status === "pending" ? (
                        <input name={`ref_${r.id}`} className="input w-28" placeholder="#1234" aria-label={`Order number for ${r.orderRef}`} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-xs whitespace-normal text-xs">
                      {r.items.map((it, i) => <div key={i}>{it.quantity != null && `${it.quantity} × `}{it.description}{it.sku && <span className="text-muted"> ({it.sku})</span>}</div>)}
                    </td>
                    <td className="r">{money(r.productCost, r.currency)}</td>
                    <td className="r">{r.shippingCost ? money(r.shippingCost, r.currency) : ""}</td>
                    <td className="r">{r.otherCost ? money(r.otherCost, r.currency) : ""}</td>
                    <td className="r font-medium">{money(r.amountBase, BASE_CURRENCY)}</td>
                    <td className="r text-muted">{money(r.estimatedCostBase, BASE_CURRENCY)}</td>
                    <td className="max-w-sm whitespace-normal text-xs text-warn-text">{r.flags.map((f, i) => <div key={i}>⚠ {f}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reviewing ? (
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pendingLabel="Applying…" name="intent" value="apply">Apply ticked orders</SubmitButton>
              {unmatched > 0 && <SubmitButton pendingLabel="Matching…" name="intent" value="rematch" variant="ghost">Match typed order numbers</SubmitButton>}
              <SubmitButton pendingLabel="Rejecting…" name="intent" value="reject" variant="ghost">Reject all</SubmitButton>
              <p className="text-xs text-muted">Lines with a warning are unticked. Applying sets each ticked order&apos;s cost of goods to the invoiced total; unticked lines are rejected.</p>
            </div>
          ) : (
            inv.status === "done" && <p className="text-sm text-muted">{money(approvedBase, BASE_CURRENCY)} applied as cost of goods.</p>
          )}
        </form>
      )}

      <form action={removeInvoice}>
        <input type="hidden" name="invoiceId" value={inv.id} />
        <SubmitButton pendingLabel="Deleting…" variant="ghost">Delete invoice</SubmitButton>
        <span className="ml-2 text-xs text-muted">Its orders go back to the SKU-cost estimate.</span>
      </form>
    </div>
  );
}
