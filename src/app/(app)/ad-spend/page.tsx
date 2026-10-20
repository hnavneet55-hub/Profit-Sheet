import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listStores } from "@/lib/stores";
import { today, addDays } from "@/lib/dates";
import { money } from "@/lib/format";
import { addAdSpend, deleteAdSpend } from "../../actions";

export default async function AdSpendPage() {
  const db = await getDb();
  const stores = await listStores();
  const rows = await db
    .select({ a: schema.adSpend, storeName: schema.stores.name })
    .from(schema.adSpend)
    .leftJoin(schema.stores, eq(schema.adSpend.storeId, schema.stores.id))
    .orderBy(desc(schema.adSpend.date), desc(schema.adSpend.id))
    .limit(200);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Ad spend</h1>
      <form action={addAdSpend} className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="storeId">Store</label>
            <select id="storeId" name="storeId" className="input" required>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="platform">Platform</label>
            <input id="platform" name="platform" className="input" defaultValue="Google Ads" />
          </div>
          <div>
            <label className="label" htmlFor="account">Ad account (optional)</label>
            <input id="account" name="account" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency of the ad account</label>
            <input id="currency" name="currency" className="input uppercase" maxLength={3} defaultValue={stores[0]?.reportingCurrency ?? "USD"} required />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-5">
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input id="date" name="date" type="date" className="input" defaultValue={addDays(today(), -1)} />
          </div>
          <div>
            <label className="label" htmlFor="amount">Amount</label>
            <input id="amount" name="amount" className="input" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="cpc">CPC (cost per click)</label>
            <input id="cpc" name="cpc" className="input" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="cvr">Conversion rate %</label>
            <input id="cvr" name="cvr" className="input" inputMode="decimal" required placeholder="buyers ÷ visitors" />
          </div>
          <div>
            <label className="label" htmlFor="note">Note</label>
            <input id="note" name="note" className="input" />
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Or paste several days at once</summary>
          <textarea name="bulk" rows={6} className="input mt-2 font-mono" placeholder={"2026-10-01\t120.50\t0.62\t1.85\n2026-10-02\t98.00\t0.58\t2.10"} />
          <p className="mt-1 text-xs text-muted">One day per line: date, amount, CPC and conversion rate %, separated by a tab or space. Copying columns from Google Ads or your sheet works. Don&apos;t use Shopify&apos;s conversion rate; when a day has none, the dashboard shows orders ÷ clicks instead.</p>
        </details>
        <button className="btn" disabled={!stores.length}>Add ad spend</button>
        {!stores.length && <p className="text-sm text-muted">Add a store first.</p>}
      </form>

      <div className="card overflow-x-auto">
        <table className="table num">
          <thead><tr><th>Date</th><th>Store</th><th>Platform</th><th>Account</th><th className="text-right">Amount</th><th className="text-right">CPC</th><th className="text-right">Clicks</th><th className="text-right">CVR</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ a, storeName }) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{storeName ?? "—"}</td>
                <td>{a.platform}</td>
                <td>{a.account ?? ""}</td>
                <td className="text-right">{money(a.amount, a.currency)}</td>
                <td className="text-right">{a.cpc ? money(a.cpc, a.currency) : <span className="text-warn-text">missing</span>}</td>
                <td className="text-right">{a.cpc ? Math.round(a.amount / a.cpc).toLocaleString("en-GB") : ""}</td>
                <td className="text-right">{a.cvr != null ? `${a.cvr}%` : <span className="text-warn-text">missing</span>}</td>
                <td className="text-muted">{a.note}</td>
                <td>
                  <form action={deleteAdSpend}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs text-muted hover:text-negative">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="py-8 text-center text-muted">No ad spend entered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
