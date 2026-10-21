import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listStores } from "@/lib/stores";
import { today, addDays } from "@/lib/dates";
import { money } from "@/lib/format";
import { addAdSpend, deleteAdSpend } from "../../actions";

export default async function AdSpendPage(props: PageProps<"/ad-spend">) {
  const sp = await props.searchParams;
  const db = await getDb();
  const stores = await listStores();
  const store = stores.find((s) => s.id === Number(sp.store));
  const rows = await db
    .select({ a: schema.adSpend, storeName: schema.stores.name })
    .from(schema.adSpend)
    .leftJoin(schema.stores, eq(schema.adSpend.storeId, schema.stores.id))
    .where(store ? eq(schema.adSpend.storeId, store.id) : undefined)
    .orderBy(desc(schema.adSpend.date), desc(schema.adSpend.id))
    .limit(200);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Ad spend{store ? ` · ${store.name}` : ""}</h1>
        <p className="text-sm text-muted">Enter the day&apos;s cost and average CPC from Google Ads. The conversion rate is calculated from the store&apos;s orders ÷ clicks.{store && <> <Link className="underline" href={`/?store=${store.id}`}>Back to {store.name}</Link></>} · <Link className="text-accent underline" href={`/ad-spend/script${store ? `?store=${store.id}` : ""}`}>Get it from Google Ads automatically</Link></p>
      </header>
      <form action={addAdSpend} className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="storeId">Store</label>
            <select id="storeId" name="storeId" className="input" required defaultValue={store?.id}>
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
            <input id="currency" name="currency" className="input uppercase" maxLength={3} defaultValue={(store ?? stores[0])?.reportingCurrency ?? "USD"} required />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
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
            <label className="label" htmlFor="note">Note</label>
            <input id="note" name="note" className="input" />
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Or paste several days at once</summary>
          <textarea name="bulk" rows={6} className="input mt-2 font-mono" placeholder={"2026-10-01\t120.50\t0.62\n2026-10-02\t98.00\t0.58"} />
          <p className="mt-1 text-xs text-muted">One day per line: date, amount and CPC, separated by a tab or space. Copying columns from Google Ads or your sheet works.</p>
        </details>
        <button className="btn" disabled={!stores.length}>Add ad spend</button>
        {!stores.length && <p className="text-sm text-muted">Add a store first.</p>}
      </form>

      <div className="card overflow-x-auto">
        <table className="table num">
          <thead><tr><th>Date</th><th>Store</th><th>Platform</th><th>Account</th><th className="text-right">Amount</th><th className="text-right">CPC</th><th className="text-right">Clicks</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ a, storeName }) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{storeName ?? "—"}</td>
                <td>{a.platform}</td>
                <td>{a.account ?? ""}</td>
                <td className="text-right">{money(a.amount, a.currency)}</td>
                <td className="text-right">{a.cpc ? money(a.cpc, a.currency) : a.amount ? <span className="text-warn-text">missing</span> : ""}</td>
                <td className="text-right">{a.cpc ? Math.round(a.amount / a.cpc).toLocaleString("en-GB") : ""}</td>
                <td className="text-muted">{a.note}</td>
                <td>
                  <form action={deleteAdSpend}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs text-muted hover:text-negative">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-muted">No ad spend entered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
