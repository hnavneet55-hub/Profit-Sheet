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

      <section className="card space-y-4 p-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Set up {store.name} in 8 steps (about 3 minutes)</h2>
          <span className="text-xs text-muted">Google sometimes moves buttons around; the names stay the same.</span>
        </div>
        <ol className="space-y-4">
          <Step n={1} title="Copy this store's script">
            <p>Click the button. It copies {store.name}&apos;s script, which only works for this store, so copy it again from the right tab for each store.</p>
            <div><CopyButton text={code} label={`Copy ${store.name}'s script`} /></div>
          </Step>
          <Step n={2} title={`Open ${store.name}'s Google Ads account`}>
            <p>Go to <a className="text-accent underline" href="https://ads.google.com" target="_blank" rel="noreferrer">ads.google.com</a> and sign in.</p>
            <p>Check the account name and ID at the top right. It must be {store.name}&apos;s account, the one that bills in <b>{store.reportingCurrency}</b>. If you use a manager (MCC) account, click the account name and pick {store.name}&apos;s account from the list first.</p>
          </Step>
          <Step n={3} title="Open Scripts">
            <div><ScriptsButton /></div>
            <p>Or, in the menu on the left, click <b>Tools</b> (the wrench icon) → <b>Bulk actions</b> → <b>Scripts</b>. Check it&apos;s still {store.name}&apos;s account at the top right.</p>
            <p>Click the blue <b>+</b> button and choose <b>New script</b>. An editor opens with a few lines of sample code.</p>
          </Step>
          <Step n={4} title="Paste the script">
            <p>Click inside the editor, select everything (<kbd>Ctrl</kbd>+<kbd>A</kbd>, on a Mac <kbd>⌘</kbd>+<kbd>A</kbd>) and press <kbd>Delete</kbd> so it&apos;s empty.</p>
            <p>Paste the script (<kbd>Ctrl</kbd>+<kbd>V</kbd> / <kbd>⌘</kbd>+<kbd>V</kbd>). The first line should read <code>{`// Profit Sheet: sends ${store.name}'s daily…`}</code>.</p>
            <p>At the top, click <b>Untitled script</b> and rename it <b>Profit Sheet</b>.</p>
          </Step>
          <Step n={5} title="Allow it to run">
            <p>A yellow bar says the script needs authorisation. Click <b>Authorize</b>, choose your Google account and click <b>Allow</b>.</p>
            <p>It asks for access to the Google Ads data and to &quot;connect to an external service&quot;: that&apos;s this dashboard.</p>
          </Step>
          <Step n={6} title="Run it once">
            <p>Click <b>Run</b> at the bottom (<b>not Preview</b>: Preview only tests and sends nothing). If it asks, confirm with <b>Run without preview</b>.</p>
            <p>Wait about 10 seconds, then open <b>Logs</b> under the editor. The last line should say <code>Sent {ADS_FIRST_DAYS} day(s): 200 {"{"}&quot;saved&quot;:…</code>. That&apos;s the last {ADS_FIRST_DAYS} days arriving here.</p>
          </Step>
          <Step n={7} title="Make it run every day">
            <p>Click <b>Save</b>, then <b>Close</b>. You&apos;re back at the list of scripts. (Lost it? <ScriptsButton small />)</p>
            <p>In the <b>Frequency</b> column of &quot;Profit Sheet&quot;, click the pencil, choose <b>Daily</b> and a time around <b>06:00</b>, and click <b>Save</b>. From now on it sends yesterday every morning.</p>
          </Step>
          <Step n={8} title="Come back here and check">
            <p>Reload this page. {store.name}&apos;s tab turns ✓ and the <b>Check</b> table appears below: each of the last {ADS_FIRST_DAYS} days with the ad spend that was entered next to Google Ads&apos; figure.</p>
            <p>Days that match show ✓. For a day that differs, click <b>Use Google Ads</b>, or <b>Use Google Ads for all days</b> to fix every one at once. Then move on to the next store&apos;s tab.</p>
          </Step>
        </ol>

        <div className="space-y-1 rounded-md bg-surface-2 p-3">
          <h3 className="font-medium">If the log shows an error instead of 200</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li><b className="text-text">Wrong store ID or token</b>: the script was copied from another store&apos;s tab. Copy it again from this tab and paste it over the old one.</li>
            <li><b className="text-text">This Google Ads account reports in …</b>: the script is in the wrong account. Check the account at the top right of Google Ads.</li>
            <li><b className="text-text">Authorization required</b>: click <b>Authorize</b> again (step 5).</li>
            <li>Nothing in the log at all: you clicked Preview. Click <b>Run</b>.</li>
          </ul>
        </div>
      </section>

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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="step-num shrink-0">{n}</span>
      <div className="space-y-1.5">
        <h3 className="font-medium">{title}</h3>
        <div className="space-y-1.5 text-muted [&_b]:text-text [&_code]:text-text">{children}</div>
      </div>
    </li>
  );
}

// Google Ads' Scripts list; it opens in the account last used in Google Ads.
const SCRIPTS_URL = "https://ads.google.com/aw/bulk/scripts";

function ScriptsButton({ small }: { small?: boolean }) {
  return small ? (
    <a className="text-accent underline" href={SCRIPTS_URL} target="_blank" rel="noreferrer">Open Scripts in Google Ads ↗</a>
  ) : (
    <a className="btn" href={SCRIPTS_URL} target="_blank" rel="noreferrer">Open Scripts in Google Ads ↗</a>
  );
}
