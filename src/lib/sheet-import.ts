import "server-only";
import * as XLSX from "xlsx";
import { and, between, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { toBase } from "./fx";

// Reads a store's old profit sheet: blocks of daily rows, each block starting
// with a header row ("Date, Revenue, COG, Adspend Google, ...") and ending with
// a month total row ("JUNE, ..."). Columns are found by name, so the order and
// the set of columns may differ between stores.

export type SheetDay = {
  date: string;
  revenue: number;
  cogs: number;
  adSpend: number;
  fees: number;
  profit: number;
  services: number;
  employee: number;
};
/** Costs only entered on a month's total row, not on any day. */
export type MonthExtra = { month: string; services: number; employee: number };
export type ParsedSheet = {
  days: SheetDay[];
  extras: MonthExtra[];
  // Currency shown in the ad spend and cost columns ($, €, kr), when the cells say.
  currencies: { adSpend: string | null; cogs: string | null };
};

type Field = Exclude<keyof SheetDay, "date">;
const COLUMNS: [Field, RegExp][] = [
  ["revenue", /^(net )?revenue$/i],
  ["cogs", /^(cogs?|cost of goods( sold)?)$/i],
  ["adSpend", /ad ?spend/i], // several ad columns (Google, Meta) are added up
  ["fees", /transaction/i],
  ["profit", /^profit$/i],
  ["services", /^services?$/i],
  ["employee", /employee|staff|salar/i],
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function readWorkbook(data: ArrayBuffer, filename: string): XLSX.WorkBook {
  // Strings, not Excel's guesses: "$1.234,56" in a CSV must not be read as a date or a US number.
  return /\.csv$/i.test(filename) ? XLSX.read(new TextDecoder().decode(data), { type: "string", raw: true }) : XLSX.read(data, { type: "array" });
}

/** Tabs that look like a store's sheet (have a "Date" header row). */
export function sheetTabs(data: ArrayBuffer, filename: string): string[] {
  const wb = readWorkbook(data, filename);
  return wb.SheetNames.filter((n) => n.toLowerCase() !== "default" && rowsOf(wb, n).some((r) => /^date$/i.test(r[0] ?? "")));
}

function rowsOf(wb: XLSX.WorkBook, tab: string): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[tab], { header: 1, raw: false, defval: "" }).map((r) => r.map((c) => String(c).trim()));
}

function currencyOf(cells: string[]): string | null {
  const count = new Map<string, number>();
  for (const c of cells) {
    const code = /€|\bEUR\b/.test(c) ? "EUR" : /\bkr\b|\bDKK\b/i.test(c) ? "DKK" : /£|\bGBP\b/.test(c) ? "GBP" : /\$|\bUSD\b/.test(c) ? "USD" : null;
    if (code) count.set(code, (count.get(code) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** "," or "." — whichever most money cells use before their last two digits. */
function decimalSeparator(rows: string[][]): "," | "." {
  let comma = 0;
  let dot = 0;
  for (const r of rows) for (const c of r) {
    if (/,\d{2}$/.test(c.replace(/[%\s]/g, ""))) comma++;
    else if (/\.\d{2}$/.test(c.replace(/[%\s]/g, ""))) dot++;
  }
  return comma > dot ? "," : ".";
}

function parseMoney(cell: string, decimal: "," | "."): number {
  const negative = /-/.test(cell) || /^\(.*\)$/.test(cell);
  let s = cell.replace(/[^\d.,]/g, "");
  if (!s) return 0;
  s = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : 0;
}

function parseDate(cell: string, year?: number): string | null {
  let y: number, m: number, d: number;
  let match;
  if (/^\d{5}$/.test(cell)) {
    // Excel serial day number (days since 1899-12-30)
    const iso = new Date(Date.UTC(1899, 11, 30) + Number(cell) * 86400_000).toISOString();
    [y, m, d] = [+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10)];
  } else if ((match = cell.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = cell.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else return null;
  if (year) y = year;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `year` replaces the year written in the sheet (for sheets copied from an old template). */
export function parseProfitSheet(data: ArrayBuffer, filename: string, year?: number, tab?: string): ParsedSheet {
  const wb = readWorkbook(data, filename);
  const rows = rowsOf(wb, tab ?? wb.SheetNames[0]);
  const decimal = decimalSeparator(rows);
  const days: SheetDay[] = [];
  const extras: MonthExtra[] = [];
  let cols: Map<Field, number[]> | null = null;
  let block: SheetDay[] = [];
  const moneyCells: Record<"adSpend" | "cogs", string[]> = { adSpend: [], cogs: [] };

  const value = (r: string[], f: Field) => (cols?.get(f) ?? []).reduce((n, i) => n + parseMoney(r[i] ?? "", decimal), 0);
  for (const r of rows) {
    const first = r[0] ?? "";
    if (/^date$/i.test(first)) {
      cols = new Map();
      r.forEach((h, i) => {
        const field = COLUMNS.find(([, re]) => re.test(h))?.[0];
        if (field) cols!.set(field, [...(cols!.get(field) ?? []), i]);
      });
      block = [];
      continue;
    }
    if (!cols) continue;
    const date = parseDate(first, year);
    if (date) {
      const day: SheetDay = { date, revenue: 0, cogs: 0, adSpend: 0, fees: 0, profit: 0, services: 0, employee: 0 };
      for (const f of cols.keys()) day[f] = value(r, f);
      for (const f of ["adSpend", "cogs"] as const) for (const i of cols.get(f) ?? []) if (parseMoney(r[i] ?? "", decimal)) moneyCells[f].push(r[i]);
      block.push(day);
      if (day.revenue || day.cogs || day.adSpend || day.services || day.employee) days.push(day);
      continue;
    }
    if (MONTHS.includes(first.toLowerCase()) && block.length) {
      // Overheads often appear only in the month total.
      const sum = (f: Field) => block.reduce((n, d) => n + d[f], 0);
      const services = value(r, "services") - sum("services");
      const employee = value(r, "employee") - sum("employee");
      if (services > 0.005 || employee > 0.005) extras.push({ month: block[0].date.slice(0, 7), services: Math.max(0, services), employee: Math.max(0, employee) });
      block = [];
    }
  }
  return { days, extras, currencies: { adSpend: currencyOf(moneyCells.adSpend), cogs: currencyOf(moneyCells.cogs) } };
}

const lastDayOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export type ImportResult = {
  store: string;
  from: string;
  to: string;
  days: number;
  adSpendDays: number;
  adSpendSkipped: number; // days that already had ad spend entered by hand
  cogsDays: number;
  cogsMissingDays: number; // sales but no cost in the sheet
  expenses: number;
};

/**
 * Saves a parsed sheet for one store. Ad spend goes in as ad spend rows (in the
 * store's ad account currency), daily figures into sheet_days, and services and
 * staff costs as business expenses. Importing the same sheet again replaces
 * what the previous import added.
 */
export async function importProfitSheet(storeId: number, sheet: ParsedSheet, withExpenses: boolean): Promise<ImportResult> {
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error("Store not found");
  if (!sheet.days.length) throw new Error("No daily rows found. The sheet needs a header row starting with “Date”.");
  // Ad spend and costs in the currency the sheet shows; overheads in the ad account's currency.
  const currency = store.reportingCurrency;
  const adCurrency = sheet.currencies.adSpend ?? currency;
  const cogsCurrency = sheet.currencies.cogs ?? currency;
  const dates = sheet.days.map((d) => d.date).sort();
  const [from, to] = [dates[0], dates.at(-1)!];

  const manual = new Set(
    (
      await db
        .select({ date: schema.adSpend.date })
        .from(schema.adSpend)
        .where(and(eq(schema.adSpend.storeId, storeId), eq(schema.adSpend.source, "manual"), between(schema.adSpend.date, from, to)))
    ).map((r) => r.date),
  );
  await db
    .delete(schema.adSpend)
    .where(and(eq(schema.adSpend.storeId, storeId), eq(schema.adSpend.source, "sheet"), between(schema.adSpend.date, from, to)));
  await db.delete(schema.sheetDays).where(and(eq(schema.sheetDays.storeId, storeId), between(schema.sheetDays.date, from, to)));

  const result: ImportResult = { store: store.name, from, to, days: sheet.days.length, adSpendDays: 0, adSpendSkipped: 0, cogsDays: 0, cogsMissingDays: 0, expenses: 0 };
  const adRows = [];
  const sheetRows = [];
  for (const d of sheet.days) {
    if (d.adSpend > 0) {
      if (manual.has(d.date)) result.adSpendSkipped++;
      else {
        adRows.push({ date: d.date, storeId, platform: "Google Ads", currency: adCurrency, amount: d.adSpend, amountBase: await toBase(d.adSpend, adCurrency, d.date), note: "From the old profit sheet", source: "sheet" });
        result.adSpendDays++;
      }
    }
    // A day with sales but no cost means the cost wasn't entered, not that it was free.
    const cogs = d.cogs > 0 ? d.cogs : null;
    if (cogs != null) result.cogsDays++;
    else if (d.revenue > 0) result.cogsMissingDays++;
    sheetRows.push({
      storeId,
      date: d.date,
      currency: cogsCurrency,
      revenue: d.revenue,
      cogs,
      cogsBase: cogs != null ? await toBase(cogs, cogsCurrency, d.date) : null,
      adSpend: d.adSpend,
      fees: d.fees,
      profit: d.profit,
    });
  }
  for (let i = 0; i < adRows.length; i += 500) await db.insert(schema.adSpend).values(adRows.slice(i, i + 500));
  for (let i = 0; i < sheetRows.length; i += 500) await db.insert(schema.sheetDays).values(sheetRows.slice(i, i + 500));

  if (withExpenses) {
    const description = `From the ${store.name} profit sheet`;
    await db
      .delete(schema.expenses)
      .where(and(eq(schema.expenses.source, "sheet"), eq(schema.expenses.description, description), between(schema.expenses.date, from, lastDayOfMonth(to.slice(0, 7)))));
    const rows: (typeof schema.expenses.$inferInsert)[] = [];
    for (const d of sheet.days) {
      if (d.services > 0) rows.push({ date: d.date, category: "Services", description, amount: d.services, currency, source: "sheet" });
      if (d.employee > 0) rows.push({ date: d.date, category: "Staff salary", description, amount: d.employee, currency, source: "sheet" });
    }
    for (const x of sheet.extras) {
      const date = lastDayOfMonth(x.month);
      if (x.services > 0) rows.push({ date, category: "Services", description, amount: x.services, currency, source: "sheet" });
      if (x.employee > 0) rows.push({ date, category: "Staff salary", description, amount: x.employee, currency, source: "sheet" });
    }
    if (rows.length) await db.insert(schema.expenses).values(rows);
    result.expenses = rows.length;
  }
  return result;
}

/** Removes everything an import added for a store (ad spend, daily figures, expenses). */
export async function undoProfitSheet(storeId: number): Promise<void> {
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) return;
  await db.delete(schema.adSpend).where(and(eq(schema.adSpend.storeId, storeId), eq(schema.adSpend.source, "sheet")));
  await db.delete(schema.sheetDays).where(eq(schema.sheetDays.storeId, storeId));
  await db.delete(schema.expenses).where(and(eq(schema.expenses.source, "sheet"), inArray(schema.expenses.description, [`From the ${store.name} profit sheet`])));
}
