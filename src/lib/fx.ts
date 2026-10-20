import "server-only";
import { and, eq, lte, desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BASE_CURRENCY } from "./config";
import { today } from "./dates";

// ECB reference rates via Frankfurter. Weekends and holidays return the last
// business day's rates, which are stored under the requested date. The first
// rates fetched for a day are stored and reused forever ("locked"), so a day's
// figures never change because of later market moves.
const FX_API = "https://api.frankfurter.dev/v1";
const memo = new Map<string, Promise<Map<string, number>>>();

async function fetchRates(date: string): Promise<Map<string, number>> {
  const db = await getDb();
  const stored = await db.select().from(schema.fxRates).where(eq(schema.fxRates.date, date));
  if (stored.length) return new Map(stored.map((r) => [r.currency, r.rate]));

  const path = date >= today() ? "latest" : date;
  const res = await fetch(`${FX_API}/${path}?base=${BASE_CURRENCY}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Exchange rates unavailable for ${date} (HTTP ${res.status})`);
  const body = (await res.json()) as { rates: Record<string, number> };
  const rates = new Map<string, number>(Object.entries(body.rates));
  rates.set(BASE_CURRENCY, 1);

  await db
    .insert(schema.fxRates)
    .values([...rates].map(([currency, rate]) => ({ date, currency, rate })))
    .onConflictDoNothing();
  // Re-read in case a concurrent request locked the day first.
  const locked = await db.select().from(schema.fxRates).where(eq(schema.fxRates.date, date));
  return new Map(locked.map((r) => [r.currency, r.rate]));
}

function ratesFor(date: string) {
  let p = memo.get(date);
  if (!p) {
    p = fetchRates(date).catch((e) => {
      memo.delete(date);
      throw e;
    });
    memo.set(date, p);
  }
  return p;
}

/** Value of 1 unit of `currency` in the base currency on `date`. */
export async function rateToBase(currency: string, date: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === BASE_CURRENCY) return 1;
  let rates: Map<string, number>;
  try {
    rates = await ratesFor(date);
  } catch (e) {
    // Fall back to the most recent stored rate so a provider outage doesn't block syncs.
    const db = await getDb();
    const [row] = await db
      .select()
      .from(schema.fxRates)
      .where(and(eq(schema.fxRates.currency, cur), lte(schema.fxRates.date, date)))
      .orderBy(desc(schema.fxRates.date))
      .limit(1);
    if (row) return 1 / row.rate;
    throw e;
  }
  const r = rates.get(cur);
  if (!r) throw new Error(`No exchange rate for ${cur} (ECB doesn't publish it)`);
  return 1 / r;
}

/** Units of `currency` per 1 unit of base currency on `date`. */
export async function rateFromBase(currency: string, date: string): Promise<number> {
  return 1 / (await rateToBase(currency, date));
}

export async function toBase(amount: number, currency: string, date: string): Promise<number> {
  return amount * (await rateToBase(currency, date));
}
