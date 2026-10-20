import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { buildSheet } from "@/lib/report";
import { money, monthLabel } from "@/lib/format";
import { undoSheetImport } from "../../actions";
import { SubmitButton } from "@/components/submit-button";
import { ImportForm } from "./form";

// Importing converts every day's amounts at that day's rate, which can take a while.
export const maxDuration = 300;

export default async function ImportPage() {
  const stores = await listStores();
  const imported = await readOnlyQuery(`
    select store_id, to_char(date, 'YYYY-MM') as month, min(date)::text as first, max(date)::text as last,
      sum(revenue) as revenue, sum(cogs) as cogs, sum(ad_spend) as ad_spend, sum(profit) as profit, min(currency) as currency
    from sheet_days group by 1, 2 order by 1, 2`);

  // Shopify's figures for the same days, in the store's report currency, next to the sheet's.
  const rows = await Promise.all(
    imported.map(async (r) => {
      const store = stores.find((s) => s.id === Number(r.store_id));
      const live = (await buildSheet({ storeId: Number(r.store_id), from: String(r.first), to: String(r.last) })).total;
      return { r, store, live };
    }),
  );
  const diff = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%` : "");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Import old profit sheets</h1>
        <p className="text-sm text-muted">
          Brings in each store&apos;s past ad spend, and its daily cost of goods: every day up to the sheet's last cost of goods entry is costed per day from the sheet; orders after that are costed one by one from supplier invoices. Revenue, refunds and fees always come from Shopify; the table below compares them with the sheet. Importing again replaces the earlier import.
        </p>
      </header>

      <ImportForm stores={stores.map((s) => ({ id: s.id, name: s.name }))} />

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table num [&_td.r]:text-right [&_th.r]:text-right">
            <thead>
              <tr>
                <th>Store</th><th>Month</th>
                <th className="r">Revenue: sheet</th><th className="r">Shopify</th><th className="r">Diff</th>
                <th className="r">Ad spend</th><th className="r">COG: sheet</th>
                <th className="r">Profit: sheet</th><th className="r">Dashboard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, store, live }) => {
                // Shopify figures are in the store's report currency; the sheet's in whatever it used.
                const cur = store?.reportingCurrency ?? String(r.currency);
                const sheetCur = String(r.currency);
                return (
                  <tr key={`${r.store_id}-${r.month}`}>
                    <td>{store?.name}</td>
                    <td>{monthLabel(String(r.month))}</td>
                    <td className="r">{money(Number(r.revenue), sheetCur)}</td>
                    <td className="r">{money(live.revenue, cur)}</td>
                    <td className={`r ${Math.abs(live.revenue - Number(r.revenue)) > Math.abs(Number(r.revenue)) * 0.05 ? "text-warn-text" : "text-muted"}`}>{sheetCur === cur ? diff(live.revenue, Number(r.revenue)) : "other currency"}</td>
                    <td className="r">{money(Number(r.ad_spend), cur)}</td>
                    <td className="r">{money(Number(r.cogs), String(r.currency))}</td>
                    <td className="r">{money(Number(r.profit), sheetCur)}</td>
                    <td className={`r font-medium ${live.profit < 0 ? "text-negative" : ""}`}>{money(live.profit, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-muted">
            The dashboard&apos;s profit also takes off refunds and the media buyer fee, which the old sheets didn&apos;t; revenue differences usually come from refunds, VAT or the day boundary (time zone).
          </p>
        </div>
      )}

      {stores.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Remove an import</summary>
          <form action={undoSheetImport} className="mt-2 flex gap-2">
            <select name="storeId" className="input w-auto">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <SubmitButton pendingLabel="Removing…" variant="ghost">Remove its imported ad spend, costs and expenses</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}
