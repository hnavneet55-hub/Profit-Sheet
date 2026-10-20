import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { uploadQuote } from "../../actions";
import { SubmitButton } from "@/components/submit-button";

const STATUS: Record<string, string> = { processing: "Reading…", pending: "Needs review", done: "Reviewed", failed: "Failed" };

export default async function QuotesPage() {
  const db = await getDb();
  const imports = await db
    .select({
      q: schema.quoteImports,
      items: sql<number>`(select count(*) from quote_items i where i.import_id = ${schema.quoteImports.id})`,
      flagged: sql<number>`(select count(*) from quote_items i where i.import_id = ${schema.quoteImports.id} and jsonb_array_length(i.flags) > 0)`,
    })
    .from(schema.quoteImports)
    .orderBy(desc(schema.quoteImports.createdAt))
    .limit(100);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Supplier quotes</h1>
        <p className="text-sm text-muted">Price lists per SKU, used to estimate the cost of orders no invoice covers yet. For what a supplier billed per order, use <Link className="underline" href="/invoices">Invoices</Link>. Claude reads each quote, matches products to your SKUs and flags anything odd. Costs only change after you approve them.</p>
      </header>

      <form action={uploadQuote} className="card max-w-2xl space-y-3 p-5">
        <h2 className="text-sm font-medium">Upload a price list</h2>
        <input type="file" name="file" accept=".xlsx,.xls,.xlsm,.csv,.ods,.pdf,application/pdf,image/png,image/jpeg,image/webp" className="input" />
        <textarea name="text" rows={3} className="input" placeholder="…or paste the supplier's message. With a file, anything typed here is passed along as context (e.g. “prices incl. shipping to EU”)." />
        <SubmitButton pendingLabel="Claude is reading the quote…">Read quote</SubmitButton>
      </form>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Received</th><th>Supplier / file</th><th>Summary</th><th className="text-right">Prices</th><th>Status</th></tr></thead>
          <tbody>
            {imports.map(({ q, items, flagged }) => (
              <tr key={q.id}>
                <td className="num">{q.createdAt.toLocaleString("en-GB")}</td>
                <td><Link className="font-medium hover:underline" href={`/quotes/${q.id}`}>{q.supplier ?? q.filename ?? `Quote #${q.id}`}</Link></td>
                <td className="max-w-md truncate text-muted" title={q.summary ?? q.error ?? ""}>{q.summary ?? q.error}</td>
                <td className="num text-right">{Number(items)}{Number(flagged) > 0 && <span className="ml-1 text-warn-text">({Number(flagged)} ⚠)</span>}</td>
                <td className={q.status === "pending" ? "font-medium text-accent" : q.status === "failed" ? "text-negative" : "text-muted"}>{STATUS[q.status] ?? q.status}</td>
              </tr>
            ))}
            {!imports.length && <tr><td colSpan={5} className="py-8 text-center text-muted">No quotes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
