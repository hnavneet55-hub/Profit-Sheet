import "server-only";
import { and, eq, isNull, lte, or, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { toBase } from "./fx";
import { today } from "./dates";

type Expense = typeof schema.expenses.$inferSelect;

/** The dates in [from, to] an expense falls on: its own date, or the same day each month. */
export function occurrences(e: Expense, from: string, to: string): string[] {
  if (!e.monthly) return e.date >= from && e.date <= to ? [e.date] : [];
  const end = e.until && e.until < to ? e.until : to;
  const day = Number(e.date.slice(8, 10));
  const out: string[] = [];
  let [y, m] = e.date.slice(0, 7).split("-").map(Number);
  for (;;) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const date = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    if (date > end) break;
    if (date >= from) out.push(date);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

/**
 * Business expenses per day in the base currency, up to today (a cost dated in
 * the future counts once its day comes). Converted at each day's locked rate.
 */
export async function expensesByDay(from: string, to: string): Promise<Map<string, number>> {
  const db = await getDb();
  const end = to < today() ? to : today();
  const out = new Map<string, number>();
  if (from > end) return out;
  const rows = await db
    .select()
    .from(schema.expenses)
    .where(
      and(
        lte(schema.expenses.date, end),
        or(and(eq(schema.expenses.monthly, false), gte(schema.expenses.date, from)), and(eq(schema.expenses.monthly, true), or(isNull(schema.expenses.until), gte(schema.expenses.until, from)))),
      ),
    );
  for (const e of rows) {
    for (const d of occurrences(e, from, end)) out.set(d, (out.get(d) ?? 0) + (await toBase(e.amount, e.currency, d)));
  }
  return out;
}
