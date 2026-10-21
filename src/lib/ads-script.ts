import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, readOnlyQuery, schema } from "@/db";
import { toBase } from "./fx";
import { addDays, daysBetween, today } from "./dates";

export const ADS_SCRIPT_SOURCE = "ads-script";
// The first run sends this many days, so what was entered before can be checked.
export const ADS_FIRST_DAYS = 30;

/** Per-store key the Google Ads script sends; derived from APP_SECRET, so nothing to store. */
export function adsToken(storeId: number): string {
  return createHmac("sha256", process.env.APP_SECRET ?? "").update(`ads-script:${storeId}`).digest("base64url").slice(0, 32);
}

export function validAdsToken(storeId: number, token: string): boolean {
  const want = Buffer.from(adsToken(storeId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type AdsDay = { date: string; cost: number; clicks: number };

/**
 * How many days (up to yesterday) the script should send: the first 30 days on its first
 * run, then only the days since the last report, so a missed run catches up by itself.
 */
export async function adsDaysToSend(storeId: number): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ last: sql<string | null>`max(${schema.adsReports.date})::text` })
    .from(schema.adsReports)
    .where(eq(schema.adsReports.storeId, storeId));
  if (!r?.last) return ADS_FIRST_DAYS;
  const yesterday = addDays(today(), -1);
  return Math.min(ADS_FIRST_DAYS, Math.max(1, daysBetween(r.last, yesterday).length - 1));
}

/**
 * Saves what a store's Google Ads script sent. A day with no ad spend yet (or only earlier
 * Google Ads figures) takes Google's figures. A day already entered by hand or from the old
 * sheet is left as it is and shows up in the check if it differs.
 */
export async function importAdsDays(storeId: number, currency: string, account: string | null, days: AdsDay[]) {
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error("Unknown store");
  if (currency !== store.reportingCurrency) {
    throw new Error(`This Google Ads account reports in ${currency}, but ${store.name} is set to ${store.reportingCurrency}. Check the store ID in the script.`);
  }
  if (!days.length) return { saved: 0, kept: 0 };
  const dates = days.map((d) => d.date);
  const entered = new Set(
    (
      await db
        .select({ date: schema.adSpend.date })
        .from(schema.adSpend)
        .where(and(eq(schema.adSpend.storeId, storeId), inArray(schema.adSpend.date, dates), sql`${schema.adSpend.source} <> ${ADS_SCRIPT_SOURCE}`))
    ).map((r) => r.date),
  );
  const fill = days.filter((d) => !entered.has(d.date));
  const rows = await adSpendRows(storeId, currency, account, fill);
  await db.transaction(async (tx) => {
    for (const d of days) {
      await tx
        .insert(schema.adsReports)
        .values({ storeId, date: d.date, currency, account, cost: d.cost, clicks: d.clicks })
        .onConflictDoUpdate({ target: [schema.adsReports.storeId, schema.adsReports.date], set: { currency, account, cost: d.cost, clicks: d.clicks, receivedAt: new Date() } });
    }
    if (fill.length) {
      await tx.delete(schema.adSpend).where(and(eq(schema.adSpend.storeId, storeId), inArray(schema.adSpend.date, fill.map((d) => d.date)), eq(schema.adSpend.source, ADS_SCRIPT_SOURCE)));
      await tx.insert(schema.adSpend).values(rows);
    }
  });
  return { saved: fill.length, kept: days.length - fill.length };
}

async function adSpendRows(storeId: number, currency: string, account: string | null, days: AdsDay[]) {
  const rows: (typeof schema.adSpend.$inferInsert)[] = [];
  for (const d of days) {
    rows.push({
      date: d.date,
      storeId,
      platform: "Google Ads",
      account,
      currency,
      amount: d.cost,
      amountBase: await toBase(d.cost, currency, d.date),
      cpc: d.clicks > 0 ? d.cost / d.clicks : null,
      note: "From Google Ads (automatic)",
      source: ADS_SCRIPT_SOURCE,
    });
  }
  return rows;
}

export type AdsCheckRow = {
  date: string;
  googleCost: number;
  googleCpc: number | null;
  enteredCost: number;
  enteredCpc: number | null;
  sources: string; // manual, sheet
  matches: boolean;
};

/** Days entered by hand or from the old sheet, next to what Google Ads reported for them. */
export async function adsCheck(storeId: number): Promise<AdsCheckRow[]> {
  const rows = await readOnlyQuery(`
    select r.date::text as d, r.cost, r.clicks,
      sum(a.amount) as entered, sum(a.amount) filter (where a.cpc > 0) as cpc_spend,
      sum(a.amount / a.cpc) filter (where a.cpc > 0) as cpc_clicks,
      string_agg(distinct a.source, ', ') as sources
    from ads_reports r
    join ad_spend a on a.store_id = r.store_id and a.date = r.date and a.source <> '${ADS_SCRIPT_SOURCE}'
    where r.store_id = ${Number(storeId)}
    group by 1, 2, 3 order by 1 desc`);
  return rows.map((r) => {
    const googleCost = Number(r.cost);
    const clicks = Number(r.clicks);
    const enteredCost = Number(r.entered);
    const cpcClicks = Number(r.cpc_clicks);
    return {
      date: String(r.d),
      googleCost,
      googleCpc: clicks > 0 ? googleCost / clicks : null,
      enteredCost,
      enteredCpc: cpcClicks > 0 ? Number(r.cpc_spend) / cpcClicks : null,
      sources: String(r.sources ?? ""),
      // A cent of rounding, or up to 1% (Google Ads finalises cost a little later), counts as the same.
      matches: Math.abs(enteredCost - googleCost) <= Math.max(0.01, googleCost * 0.01),
    };
  });
}

/** Replaces the ad spend of these days with what Google Ads reported for them. */
export async function applyGoogleFigures(storeId: number, dates: string[]) {
  const db = await getDb();
  if (!dates.length) return;
  const reports = await db
    .select()
    .from(schema.adsReports)
    .where(and(eq(schema.adsReports.storeId, storeId), inArray(schema.adsReports.date, dates)));
  if (!reports.length) return;
  const rows: (typeof schema.adSpend.$inferInsert)[] = [];
  for (const r of reports) rows.push(...(await adSpendRows(storeId, r.currency, r.account, [r])));
  await db.transaction(async (tx) => {
    await tx.delete(schema.adSpend).where(and(eq(schema.adSpend.storeId, storeId), inArray(schema.adSpend.date, reports.map((r) => r.date))));
    await tx.insert(schema.adSpend).values(rows);
  });
}

/** The script to paste into the store's Google Ads account (Tools → Bulk actions → Scripts). */
export function adsScript(storeId: number, storeName: string, endpoint: string): string {
  return `// Profit Sheet: sends ${storeName}'s daily Google Ads cost and clicks to the dashboard.
// The first run sends the last ${ADS_FIRST_DAYS} days so earlier entries can be checked;
// after that, schedule it daily and it sends yesterday (and any day it missed).
var DASHBOARD_URL = "${endpoint}";
var STORE_ID = ${storeId};
var TOKEN = "${adsToken(storeId)}";

function main() {
  var auth = "?storeId=" + STORE_ID + "&token=" + encodeURIComponent(TOKEN);
  // Ask the dashboard how many days it needs.
  var ask = UrlFetchApp.fetch(DASHBOARD_URL + auth, { muteHttpExceptions: true });
  if (ask.getResponseCode() !== 200) throw new Error("Dashboard said: " + ask.getContentText());
  var DAYS = JSON.parse(ask.getContentText()).days;

  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var day = function (offset) {
    return Utilities.formatDate(new Date(Date.now() - offset * 86400000), tz, "yyyy-MM-dd");
  };
  // Every day from DAYS ago up to yesterday, 0 when nothing ran.
  var byDate = {};
  for (var i = DAYS; i >= 1; i--) byDate[day(i)] = { date: day(i), cost: 0, clicks: 0 };
  var rows = AdsApp.search(
    "SELECT segments.date, metrics.cost_micros, metrics.clicks FROM customer " +
    "WHERE segments.date BETWEEN '" + day(DAYS) + "' AND '" + day(1) + "'"
  );
  while (rows.hasNext()) {
    var r = rows.next();
    var d = byDate[r.segments.date];
    if (!d) continue;
    d.cost += Number(r.metrics.costMicros) / 1000000;
    d.clicks += Number(r.metrics.clicks);
  }
  var res = UrlFetchApp.fetch(DASHBOARD_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      storeId: STORE_ID,
      token: TOKEN,
      currency: account.getCurrencyCode(),
      account: account.getCustomerId(),
      days: Object.keys(byDate).map(function (k) { return byDate[k]; })
    })
  });
  Logger.log("Sent " + DAYS + " day(s): " + res.getResponseCode() + " " + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error("Dashboard said: " + res.getContentText());
}
`;
}
