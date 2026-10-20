import type { schema } from "@/db";
import { deleteStore, saveStore } from "../../actions";

type Store = typeof schema.stores.$inferSelect;

export function StoreForm({ store }: { store?: Store }) {
  return (
    <div className="max-w-2xl space-y-6">
      <form action={saveStore} className="card space-y-5 p-5">
        {store && <input type="hidden" name="id" value={store.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" defaultValue={store?.name} required />
          </div>
          <div>
            <label className="label" htmlFor="shopDomain">Shopify domain</label>
            <input id="shopDomain" name="shopDomain" className="input" placeholder="my-store.myshopify.com" defaultValue={store?.shopDomain} required />
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Shopify access</legend>
          <select name="authType" className="input" defaultValue={store?.authType ?? "client_credentials"}>
            <option value="client_credentials">Dev Dashboard app (client ID + secret)</option>
            <option value="token">Admin API access token (existing custom app)</option>
          </select>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="clientId">Client ID</label>
              <input id="clientId" name="clientId" className="input" defaultValue={store?.clientId ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="clientSecret">Client secret {store?.clientSecretEnc && "(saved, leave blank to keep)"}</label>
              <input id="clientSecret" name="clientSecret" type="password" className="input" autoComplete="off" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="accessToken">Access token {store?.accessTokenEnc && "(saved, leave blank to keep)"}</label>
            <input id="accessToken" name="accessToken" type="password" className="input" autoComplete="off" placeholder="shpat_…" />
          </div>
          <p className="text-xs text-muted">Needs the <code>read_orders</code> scope (and <code>read_all_orders</code> for history beyond 60 days). Secrets are stored encrypted.</p>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Reporting</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="reportingCurrency">Report currency (Google Ads account currency)</label>
              <input id="reportingCurrency" name="reportingCurrency" className="input uppercase" maxLength={3} defaultValue={store?.reportingCurrency ?? "USD"} required />
            </div>
            <div>
              <label className="label" htmlFor="mediaBuyerFeePct">Media buyer fee (% of ad spend)</label>
              <input id="mediaBuyerFeePct" name="mediaBuyerFeePct" className="input" inputMode="decimal" defaultValue={store?.mediaBuyerFeePct ?? 10} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Transaction fees</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="useReportedFees" defaultChecked={store?.useReportedFees ?? true} />
            Use the fee Shopify reports on each payment when available (Shopify Payments)
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="paymentFeePct">Payment fee %</label>
              <input id="paymentFeePct" name="paymentFeePct" className="input" inputMode="decimal" defaultValue={store?.paymentFeePct ?? 2.9} />
            </div>
            <div>
              <label className="label" htmlFor="paymentFeeFixed">Fixed fee per order (shop currency)</label>
              <input id="paymentFeeFixed" name="paymentFeeFixed" className="input" inputMode="decimal" defaultValue={store?.paymentFeeFixed ?? 0.3} />
            </div>
            <div>
              <label className="label" htmlFor="platformFeePct">Shopify fee on other gateways %</label>
              <input id="platformFeePct" name="platformFeePct" className="input" inputMode="decimal" defaultValue={store?.platformFeePct ?? 0} />
            </div>
          </div>
          <p className="text-xs text-muted">The rule is used for orders where Shopify reports no fee (e.g. PayPal). Shopify&apos;s own fee for non-Shopify-Payments gateways is added on top.</p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={store?.active ?? true} /> Active (included in syncs)
        </label>
        <button className="btn">Save store</button>
      </form>

      {store && (
        <form action={deleteStore} className="card flex items-center justify-between p-5">
          <input type="hidden" name="id" value={store.id} />
          <p className="text-sm text-muted">Deleting a store removes its synced orders and refunds.</p>
          <button className="btn-ghost text-negative">Delete store</button>
        </form>
      )}
    </div>
  );
}
