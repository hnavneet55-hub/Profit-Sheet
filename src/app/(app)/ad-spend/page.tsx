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
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input id="date" name="date" type="date" className="input" defaultValue={addDays(today(), -1)} />
          </div>
          <div>
            <label className="label" htmlFor="amount">Amount</label>
            <input id="amount" name="amount" className="input" inputMode="decimal" />
          </div>
          <div>
            <label className="label" htmlFor="note">Note</label>
            <input id="note" name="note" className="input" />
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Or paste several days at once</summary>
          <textarea name="bulk" rows={6} className="input mt-2 font-mono" placeholder={"2026-10-01\t120.50\n2026-10-02\t98.00"} />
          <p className="mt-1 text-xs text-muted">One day per line: date and amount, separated by a tab, comma or space. Copying two columns from Google Ads or a sheet works.</p>
        </details>
        <button className="btn" disabled={!stores.length}>Add ad spend</button>
        {!stores.length && <p className="text-sm text-muted">Add a store first.</p>}
      </form>

      <div className="card overflow-x-auto">
        <table className="table num">
          <thead><tr><th>Date</th><th>Store</th><th>Platform</th><th>Account</th><th className="text-right">Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ a, storeName }) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{storeName ?? "—"}</td>
                <td>{a.platform}</td>
                <td>{a.account ?? ""}</td>
                <td className="text-right">{money(a.amount, a.currency)}</td>
                <td className="text-muted">{a.note}</td>
                <td>
                  <form action={deleteAdSpend}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs text-muted hover:text-negative">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-muted">No ad spend entered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
