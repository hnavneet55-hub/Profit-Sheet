import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, today } from "@/lib/dates";

const PAGE = 200;
const SOURCES: Record<string, string> = { user: "People", script: "Google Ads script", cron: "Hourly sync", api: "API" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function LogsPage(props: PageProps<"/logs">) {
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = ISO.test(one("from")) ? one("from") : addDays(today(), -6);
  const to = ISO.test(one("to")) ? one("to") : today();
  const q = one("q");
  const source = one("source");
  const actor = one("actor");
  const area = one("area");
  const storeId = Number(one("store")) || null;
  const limit = Math.min(Number(one("limit")) || PAGE, 2000);

  const db = await getDb();
  const L = schema.activityLog;
  const where: SQL[] = [gte(L.day, from), lte(L.day, to)];
  if (source) where.push(eq(L.source, source));
  if (actor) where.push(eq(L.actor, actor));
  if (area) where.push(eq(L.area, area));
  if (storeId) where.push(eq(L.storeId, storeId));
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(L.summary, like), ilike(L.actor, like), ilike(L.storeName, like), sql`${L.details}::text ilike ${like}`)!);
  }

  const [rows, actors, areas, stores] = await Promise.all([
    db.select().from(L).where(and(...where)).orderBy(desc(L.at)).limit(limit + 1),
    db.selectDistinct({ v: L.actor }).from(L).orderBy(L.actor),
    db.selectDistinct({ v: L.area }).from(L).orderBy(L.area),
    db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).orderBy(schema.stores.name),
  ]);
  const more = rows.length > limit;
  const shown = rows.slice(0, limit);

  // Group by day (newest first); within a day the newest entry is on top.
  const days = new Map<string, typeof shown>();
  for (const r of shown) days.set(r.day, [...(days.get(r.day) ?? []), r]);

  const moreHref = `/logs?${new URLSearchParams({ from, to, q, source, actor, area, store: storeId ? String(storeId) : "", limit: String(limit + PAGE) })}`;
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: process.env.REPORT_TIMEZONE ?? "Europe/Copenhagen" }).format(d);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted">Every change made by people, the Google Ads script and the hourly sync, day by day. Search or filter to find anything.</p>
      </header>

      <form className="card flex flex-wrap items-end gap-3 p-3">
        <label className="text-xs text-muted">From<input type="date" name="from" defaultValue={from} className="input mt-1" /></label>
        <label className="text-xs text-muted">To<input type="date" name="to" defaultValue={to} className="input mt-1" /></label>
        <label className="min-w-48 flex-1 text-xs text-muted">Search<input name="q" defaultValue={q} placeholder="Store, order, SKU, amount, date…" className="input mt-1 w-full" /></label>
        <label className="text-xs text-muted">By
          <select name="actor" defaultValue={actor} className="input mt-1"><option value="">Anyone</option>{actors.map((a) => <option key={a.v}>{a.v}</option>)}</select>
        </label>
        <label className="text-xs text-muted">Type
          <select name="source" defaultValue={source} className="input mt-1"><option value="">All</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="text-xs text-muted">Section
          <select name="area" defaultValue={area} className="input mt-1"><option value="">All</option>{areas.map((a) => <option key={a.v}>{a.v}</option>)}</select>
        </label>
        <label className="text-xs text-muted">Store
          <select name="store" defaultValue={storeId ?? ""} className="input mt-1"><option value="">All</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <button className="btn">Show</button>
        <Link href="/logs" className="btn-ghost">Reset</Link>
      </form>

      {shown.length === 0 && <div className="card px-4 py-6 text-sm text-muted">No activity for these filters.</div>}

      {[...days].map(([day, entries]) => (
        <section key={day} className="card overflow-x-auto">
          <h2 className="px-3 pt-3 text-sm font-medium">{day} <span className="font-normal text-muted">· {entries.length} change{entries.length === 1 ? "" : "s"}</span></h2>
          <table className="table">
            <thead><tr><th>Time</th><th>By</th><th>Section</th><th>Store</th><th>What changed</th></tr></thead>
            <tbody>
              {entries.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap">{time(r.at)}</td>
                  <td className="whitespace-nowrap">{r.actor}{r.source !== "user" && <span className="ml-1 text-xs text-muted">({SOURCES[r.source] ?? r.source})</span>}</td>
                  <td className="whitespace-nowrap">{r.area}</td>
                  <td className="whitespace-nowrap">{r.storeName ?? "—"}</td>
                  <td>
                    {r.summary}
                    {r.details != null && (
                      <details className="mt-1 text-xs text-muted">
                        <summary className="cursor-pointer">Details</summary>
                        <pre className="mt-1 max-w-3xl overflow-x-auto whitespace-pre-wrap">{JSON.stringify(r.details, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {more && <Link href={moreHref} className="btn-ghost inline-block">Show older entries</Link>}
    </div>
  );
}
