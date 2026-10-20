import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listStores } from "@/lib/stores";
import { money } from "@/lib/format";
import { uploadInvoice } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

// Reading a large supplier export with Claude can take a couple of minutes.
export const maxDuration = 300;

const STATUS: Record<string, string> = { processing: "Reading…", pending: "Needs review", done: "Reviewed", failed: "Failed" };

export default async function InvoicesPage(props: PageProps<"/invoices">) {
  const sp = await props.searchParams;
  const storeId = Number(sp.store) || undefined;
  const db = await getDb();
  const stores = await listStores();
  const invoices = await db
    .select({
      inv: schema.supplierInvoices,
      store: schema.stores.name,
      orders: sql<number>`(select count(*) from invoice_orders o where o.invoice_id = ${schema.supplierInvoices.id})`,
      flagged: sql<number>`(select count(*) from invoice_orders o where o.invoice_id = ${schema.supplierInvoices.id} and jsonb_array_length(o.flags) > 0)`,
    })
    .from(schema.supplierInvoices)
    .innerJoin(schema.stores, eq(schema.supplierInvoices.storeId, schema.stores.id))
    .where(storeId ? eq(schema.supplierInvoices.storeId, storeId) : undefined)
    .orderBy(desc(schema.supplierInvoices.createdAt))
    .limit(200);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Supplier invoices</h1>
        <p className="text-sm text-muted">
          Upload what a supplier billed you. Claude reads it and matches each line to the store&apos;s order by order number. Once approved, the invoiced amount (goods, shipping and fees) becomes that order&apos;s cost of goods in place of the SKU-cost estimate.
        </p>
      </header>

      <form action={uploadInvoice} className="card max-w-2xl space-y-3 p-5">
        <h2 className="text-sm font-medium">Upload an invoice</h2>
        <div>
          <label className="label" htmlFor="storeId">Store this invoice is for</label>
          <select id="storeId" name="storeId" className="input" required defaultValue={storeId ?? ""}>
            <option value="" disabled>Choose a store…</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="file">Invoice file</label>
          <input id="file" type="file" name="file" required accept=".pdf,application/pdf,.xlsx,.xls,.xlsm,.csv,.ods,image/png,image/jpeg,image/webp" className="input" />
          <p className="mt-1 text-xs text-muted">PDF, Excel/CSV or a screenshot, up to 4 MB. For invoices shown only on a supplier&apos;s website, save the page as PDF (Print → Save as PDF).</p>
        </div>
        <textarea name="text" rows={2} className="input" placeholder="Optional note for Claude, e.g. “prices are in USD” or “shipping is the last column”" />
        <SubmitButton pendingLabel="Claude is reading the invoice…">Read invoice</SubmitButton>
        {!stores.length && <p className="text-sm text-muted">Add a store first.</p>}
      </form>

      <div className="flex items-center gap-2">
        <form className="flex gap-2">
          <select name="store" defaultValue={storeId ?? ""} className="input w-auto">
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-ghost">Show</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Uploaded</th><th>Store</th><th>Supplier / file</th><th>Invoice</th><th className="text-right">Total</th><th className="text-right">Orders</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map(({ inv, store, orders, flagged }) => (
              <tr key={inv.id}>
                <td className="num">{inv.createdAt.toLocaleString("en-GB")}</td>
                <td>{store}</td>
                <td><Link className="font-medium hover:underline" href={`/invoices/${inv.id}`}>{inv.supplier ?? inv.filename ?? `Invoice #${inv.id}`}</Link></td>
                <td className="num">{[inv.invoiceNumber, inv.invoiceDate].filter(Boolean).join(" · ") || (inv.error ? <span className="text-negative">{inv.error}</span> : "—")}</td>
                <td className="num text-right">{inv.total != null && inv.currency ? money(inv.total, inv.currency) : "—"}</td>
                <td className="num text-right">{Number(orders)}{Number(flagged) > 0 && <span className="ml-1 text-warn-text">({Number(flagged)} ⚠)</span>}</td>
                <td className={inv.status === "pending" ? "font-medium text-accent" : inv.status === "failed" ? "text-negative" : "text-muted"}>{STATUS[inv.status] ?? inv.status}</td>
              </tr>
            ))}
            {!invoices.length && <tr><td colSpan={7} className="py-8 text-center text-muted">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
