import Link from "next/link";
import { headers } from "next/headers";
import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { adsScript, ADS_SCRIPT_SOURCE } from "@/lib/ads-script";
import { CopyButton } from "@/components/copy-button";

/** Ready-to-paste Google Ads script per store, so ad spend and CPC arrive by themselves. */
export default async function AdsScriptPage(props: PageProps<"/ad-spend/script">) {
  const sp = await props.searchParams;
  const stores = (await listStores()).filter((s) => s.active);
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const h = await headers();
  const endpoint = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/api/ads/import`;
  const last = new Map(
    (await readOnlyQuery(`select store_id, max(created_at) as at from ad_spend where source = '${ADS_SCRIPT_SOURCE}' group by 1`)).map((r) => [Number(r.store_id), new Date(String(r.at))]),
  );
  if (!store) return <p className="text-sm text-muted">Add a store first.</p>;
  const code = adsScript(store.id, store.name, endpoint);
  const at = last.get(store.id);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Google Ads: automatic ad spend</h1>
        <p className="text-sm text-muted">Set this up once per store. Every morning Google Ads sends the previous days&apos; cost and clicks, so the CPC and conversion rate fill in by themselves and only the cost of goods is left to enter.</p>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Stores">
        {stores.map((s) => (
          <Link key={s.id} href={`/ad-spend/script?store=${s.id}`} className={`store-tab ${s.id === store.id ? "store-tab-on" : ""}`}>
            <span>{s.name}</span>
            <span className={`badge ${last.has(s.id) ? "badge-ok" : "badge-warn"}`}>{last.has(s.id) ? "✓" : "—"}</span>
          </Link>
        ))}
      </nav>

      <div className={at ? "alert-ok text-sm" : "alert-warn text-sm"}>
        {at ? `✓ ${store.name} is connected. Last data from Google Ads: ${at.toLocaleString("en-GB")}.` : `${store.name} isn't connected yet. Follow the steps below in ${store.name}'s Google Ads account (${store.reportingCurrency}).`}
      </div>

      <ol className="card list-decimal space-y-2 p-5 pl-10 text-sm">
        <li>Open <b>{store.name}&apos;s</b> Google Ads account, the one that bills in {store.reportingCurrency}.</li>
        <li>Go to <b>Tools → Bulk actions → Scripts</b> and click the blue <b>+</b> → <b>New script</b>.</li>
        <li>Delete what&apos;s in the editor, then click <b>Copy script</b> below and paste it in. Name it &quot;Profit Sheet&quot;.</li>
        <li>Click <b>Authorize</b> and allow access with your Google account.</li>
        <li>Click <b>Preview</b>. The log at the bottom should end with <code>200 {"{"}&quot;saved&quot;:7…</code>.</li>
        <li>Click <b>Save</b>, then set <b>Frequency</b> to <b>Daily</b>, around 06:00. Done: this page shows ✓ for {store.name}.</li>
      </ol>

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Script for {store.name} (store ID {store.id})</h2>
          <CopyButton text={code} label="Copy script" />
        </div>
        <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 text-xs"><code>{code}</code></pre>
        <p className="text-xs text-muted">Each store has its own script; don&apos;t reuse one store&apos;s script in another account. Days Google Ads sends replace ad spend typed in by hand for those days; days from the old profit sheet are kept.</p>
      </section>
    </div>
  );
}
