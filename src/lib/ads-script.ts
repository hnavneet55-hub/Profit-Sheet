import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { toBase } from "./fx";

export const ADS_SCRIPT_SOURCE = "ads-script";
// The script re-sends this many days each run, so late Google Ads corrections land too.
export const ADS_SCRIPT_DAYS = 7;

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
 * Saves the days a store's Google Ads script sent. Each day replaces what was typed in by
 * hand or sent earlier; days imported from the old profit sheet are left alone.
 */
export async function importAdsDays(storeId: number, currency: string, account: string | null, days: AdsDay[]) {
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error("Unknown store");
  if (currency !== store.reportingCurrency) {
    throw new Error(`This Google Ads account reports in ${currency}, but ${store.name} is set to ${store.reportingCurrency}. Check the store ID in the script.`);
  }
  const dates = days.map((d) => d.date);
  const sheetDates = new Set(
    (
      await db
        .select({ date: schema.adSpend.date })
        .from(schema.adSpend)
        .where(and(eq(schema.adSpend.storeId, storeId), eq(schema.adSpend.source, "sheet"), inArray(schema.adSpend.date, dates)))
    ).map((r) => r.date),
  );
  const keep = days.filter((d) => !sheetDates.has(d.date));
  const values: (typeof schema.adSpend.$inferInsert)[] = [];
  for (const d of keep) {
    values.push({
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
  await db.transaction(async (tx) => {
    if (keep.length) {
      await tx.delete(schema.adSpend).where(
        and(eq(schema.adSpend.storeId, storeId), inArray(schema.adSpend.date, keep.map((d) => d.date)), inArray(schema.adSpend.source, ["manual", ADS_SCRIPT_SOURCE])),
      );
      await tx.insert(schema.adSpend).values(values);
    }
  });
  return { saved: keep.length, skipped: days.length - keep.length };
}

/** The script to paste into the store's Google Ads account (Tools → Bulk actions → Scripts). */
export function adsScript(storeId: number, storeName: string, endpoint: string): string {
  return `// Profit Sheet: sends ${storeName}'s daily Google Ads cost and clicks to the dashboard.
// Schedule it to run daily. It re-sends the last ${ADS_SCRIPT_DAYS} days each time.
var DASHBOARD_URL = "${endpoint}";
var STORE_ID = ${storeId};
var TOKEN = "${adsToken(storeId)}";
var DAYS = ${ADS_SCRIPT_DAYS};

function main() {
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
  Logger.log(res.getResponseCode() + " " + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error("Dashboard said: " + res.getContentText());
}
`;
}
