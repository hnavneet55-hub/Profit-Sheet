import Link from "next/link";
import { listStores } from "@/lib/stores";
import { syncNow } from "../../actions";

export default async function StoresPage() {
  const stores = await listStores();
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Stores</h1>
        <div className="flex gap-2">
          <form action={syncNow}><button className="btn-ghost">Sync all</button></form>
          <Link href="/stores/new" className="btn">Add store</Link>
        </div>
      </header>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Store</th><th>Shop currency</th><th>Reports in</th><th>Fees (rule)</th><th>Media buyer</th><th>Last sync</th><th></th></tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id} className={s.active ? "" : "text-muted"}>
                <td>
                  <Link href={`/stores/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                  <div className="text-xs text-muted">{s.shopDomain}</div>
                </td>
                <td>{s.currency ?? "—"}</td>
                <td>{s.reportingCurrency}</td>
                <td className="num">{s.paymentFeePct}% + {s.paymentFeeFixed}{s.platformFeePct ? ` · Shopify ${s.platformFeePct}%` : ""}{s.useReportedFees ? " · uses reported fees" : ""}</td>
                <td className="num">{s.mediaBuyerFeePct}%</td>
                <td>
                  {s.lastSyncedAt ? s.lastSyncedAt.toLocaleString("en-GB") : "Never"}
                  {s.lastSyncError && <div className="max-w-xs truncate text-xs text-negative" title={s.lastSyncError}>{s.lastSyncError}</div>}
                </td>
                <td>
                  <form action={syncNow}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn-ghost">Sync</button>
                  </form>
                </td>
              </tr>
            ))}
            {!stores.length && (
              <tr><td colSpan={7} className="py-8 text-center text-muted">No stores yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        The first sync imports the last 90 days of orders. Orders older than 60 days need the <code>read_all_orders</code> scope on the Shopify app.
      </p>
    </div>
  );
}
