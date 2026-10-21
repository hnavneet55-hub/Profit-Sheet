import Link from "next/link";
import { headers } from "next/headers";
import { readOnlyQuery } from "@/db";
import { listStores } from "@/lib/stores";
import { adsCheck, adsScript, ADS_FIRST_DAYS } from "@/lib/ads-script";
import { money } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { takeGoogleAdsFigures } from "../../../actions";

/** Ready-to-paste Google Ads script per store, so ad spend and CPC arrive by themselves. */
export default async function AdsScriptPage(props: PageProps<"/ad-spend/script">) {
  const sp = await props.searchParams;
  const stores = (await listStores()).filter((s) => s.active);
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const h = await headers();
  const endpoint = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/api/ads/import`;
  const last = new Map(
    (await readOnlyQuery(`select store_id, max(received_at) as at from ads_reports group by 1`)).map((r) => [Number(r.store_id), new Date(String(r.at))]),
  );
  if (!store) return <p className="text-sm text-muted">Add a store first.</p>;
  const code = adsScript(store.id, store.name, endpoint);
  const at = last.get(store.id);
  const check = at ? await adsCheck(store.id) : [];
  const differ = check.filter((r) => !r.matches);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Google Ads: automatic ad spend</h1>
        <p className="text-sm text-muted">Set this up once per store. The first run sends the last {ADS_FIRST_DAYS} days, so everything entered before can be checked against Google Ads. After that it sends yesterday every morning, so ad spend, CPC and conversion rate fill in by themselves and only the cost of goods is left to enter.</p>
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
        <li>Click <b>Run</b> (not Preview, which doesn&apos;t send anything). The log should say <code>Sent {ADS_FIRST_DAYS} day(s): 200</code>. The check below then compares those days with what was entered.</li>
        <li>Click <b>Save</b>, then set <b>Frequency</b> to <b>Daily</b>, around 06:00. Done: this page shows ✓ for {store.name}.</li>
      </ol>

      {at && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <h2 className="text-sm font-medium">
              Check: entered ad spend vs Google Ads ·{" "}
              {check.length === 0 ? "nothing entered by hand for these days" : differ.length ? <span className="text-negative">{differ.length} of {check.length} days differ</span> : <span className="text-positive">✓ all {check.length} days match</span>}
            </h2>
            {differ.length > 1 && (
              <form action={takeGoogleAdsFigures}>
                <input type="hidden" name="storeId" value={store.id} />
                {differ.map((r) => <input key={r.date} type="hidden" name="date" value={r.date} />)}
                <SubmitButton pendingLabel="Updating…">Use Google Ads for all {differ.length} days</SubmitButton>
              </form>
            )}
          </div>
          {check.length > 0 && (
            <table className="table num [&_td]:text-right [&_th]:text-right [&_th:first-child]:text-left">
              <thead><tr><th>Day</th><th>Entered</th><th>Google Ads</th><th>Difference</th><th>CPC entered</th><th>CPC Google Ads</th><th className="!text-left">From</th><th></th></tr></thead>
              <tbody>
                {check.map((r) => (
                  <tr key={r.date}>
                    <td className="text-left">{r.date}</td>
                    <td>{money(r.enteredCost, store.reportingCurrency)}</td>
                    <td>{money(r.googleCost, store.reportingCurrency)}</td>
                    <td className={r.matches ? "text-positive" : "font-semibold text-negative"}>{r.matches ? "✓" : money(r.enteredCost - r.googleCost, store.reportingCurrency)}</td>
                    <td>{r.enteredCpc == null ? "—" : money(r.enteredCpc, store.reportingCurrency)}</td>
                    <td>{r.googleCpc == null ? "—" : money(r.googleCpc, store.reportingCurrency)}</td>
                    <td className="!text-left text-muted">{r.sources === "sheet" ? "old sheet" : r.sources === "manual" ? "typed in" : r.sources}</td>
                    <td>
                      {!r.matches && (
                        <form action={takeGoogleAdsFigures}>
                          <input type="hidden" name="storeId" value={store.id} />
                          <input type="hidden" name="date" value={r.date} />
                          <SubmitButton variant="ghost" pendingLabel="…">Use Google Ads</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-3 text-xs text-muted">Days that weren&apos;t entered yet were filled in from Google Ads automatically. Days entered by hand or from the old sheet are kept until you choose Google Ads&apos; figure.</p>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Script for {store.name} (store ID {store.id})</h2>
          <CopyButton text={code} label="Copy script" />
        </div>
        <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 text-xs"><code>{code}</code></pre>
        <p className="text-xs text-muted">Each store has its own script; don&apos;t reuse one store&apos;s script in another account. Already set up an earlier version of the script? Replace it with this one.</p>
      </section>
    </div>
  );
}
