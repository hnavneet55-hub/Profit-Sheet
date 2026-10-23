"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, findAccount, sessionToken } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { toBase } from "@/lib/fx";
import { recomputeForSkus, recomputeForStore } from "@/lib/costs";
import { syncStores } from "@/lib/sync";
import { applyQuoteItems, importQuote } from "@/lib/quotes";
import { deleteInvoice, importInvoice, rematchInvoiceOrder, reviewInvoiceOrders } from "@/lib/invoices";
import { inputFromForm } from "@/lib/supplier-files";
import { importProfitSheet, parseProfitSheet, sheetTabs, undoProfitSheet, type ImportResult } from "@/lib/sheet-import";
import { listStores } from "@/lib/stores";
import { ask, type AskTurn, type AskResult } from "@/lib/ask";
import { applyGoogleFigures } from "@/lib/ads-script";
import { logActivity } from "@/lib/activity";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOr = (f: FormData, k: string, d = 0) => {
  const v = str(f, k).replace(",", ".");
  return v === "" ? d : Number(v);
};

// ---- Login ----

export async function login(_: string | null, form: FormData): Promise<string | null> {
  const account = findAccount(str(form, "user"), str(form, "password"));
  if (!account) {
    await logActivity({ area: "Sign-in", summary: `Failed sign-in for "${str(form, "user")}"`, actor: str(form, "user") || "(blank)" });
    return "Wrong user ID or password";
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(account), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  await logActivity({ area: "Sign-in", summary: "Signed in", actor: account.user });
  const next = str(form, "next");
  redirect(next.startsWith("/") ? next : "/");
}

export async function logout() {
  await logActivity({ area: "Sign-in", summary: "Signed out" });
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** Hides or shows the side menu, so the sheets can use the whole screen. */
export async function toggleMenu() {
  const jar = await cookies();
  if (jar.get("ps_menu")?.value === "hidden") jar.delete("ps_menu");
  else jar.set("ps_menu", "hidden", { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

// ---- Stores ----

export async function saveStore(form: FormData) {
  const db = await getDb();
  const id = Number(str(form, "id")) || null;
  const domain = str(form, "shopDomain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const authType = str(form, "authType") === "client_credentials" ? "client_credentials" : "token";
  const values: Partial<typeof schema.stores.$inferInsert> = {
    name: str(form, "name"),
    shopDomain: domain.includes(".") ? domain : `${domain}.myshopify.com`,
    authType,
    reportingCurrency: str(form, "reportingCurrency").toUpperCase() || "USD",
    paymentFeePct: numOr(form, "paymentFeePct"),
    paymentFeeFixed: numOr(form, "paymentFeeFixed"),
    platformFeePct: numOr(form, "platformFeePct"),
    mediaBuyerFeePct: numOr(form, "mediaBuyerFeePct"),
    cogsTargetPct: str(form, "cogsTargetPct") ? numOr(form, "cogsTargetPct") : null,
    useReportedFees: form.get("useReportedFees") === "on",
    active: form.get("active") === "on",
  };
  // Secrets are only replaced when a new value is typed in.
  if (str(form, "accessToken")) values.accessTokenEnc = encrypt(str(form, "accessToken"));
  if (str(form, "clientId")) values.clientId = str(form, "clientId");
  if (str(form, "clientSecret")) values.clientSecretEnc = encrypt(str(form, "clientSecret"));

  if (id) {
    await db.update(schema.stores).set(values).where(eq(schema.stores.id, id));
    await recomputeForStore(id); // fee rules may have changed
    const shown = Object.fromEntries(Object.entries(values).filter(([k]) => !/token|secret|clientId/i.test(k))); // never log credentials
    const changedKeys = ["accessToken", "clientId", "clientSecret"].filter((k) => str(form, k));
    await logActivity({ area: "Stores", summary: `Edited store ${values.name}${changedKeys.length ? ` (new ${changedKeys.join(", ")})` : ""}`, storeId: id, details: shown });
  } else {
    const [row] = await db.insert(schema.stores).values(values as typeof schema.stores.$inferInsert).returning({ id: schema.stores.id });
    await logActivity({ area: "Stores", summary: `Added store ${values.name} (${values.shopDomain})`, storeId: row.id });
  }
  revalidatePath("/", "layout");
  redirect("/stores");
}

export async function deleteStore(form: FormData) {
  const db = await getDb();
  const [store] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, Number(str(form, "id"))));
  await db.delete(schema.stores).where(eq(schema.stores.id, Number(str(form, "id"))));
  await logActivity({ area: "Stores", summary: `Deleted store ${store?.name ?? `#${str(form, "id")}`} with all its data` });
  revalidatePath("/", "layout");
  redirect("/stores");
}

export async function syncNow(form: FormData) {
  const id = Number(str(form, "id")) || undefined;
  const results = await syncStores(id ? [id] : undefined);
  await logActivity({
    area: "Sync",
    summary: `Manual sync: ${results.map((r) => `${r.store} ${r.orders} orders${r.error ? ` (error: ${r.error})` : ""}`).join("; ") || "no stores"}`,
    storeId: id ?? null,
    details: { results },
  });
  revalidatePath("/", "layout");
}

// ---- Ad spend ----

async function insertAdSpend(rows: { date: string; storeId: number | null; platform: string; account: string | null; currency: string; amount: number; cpc: number | null; note: string | null }[]) {
  const db = await getDb();
  const values = [];
  for (const r of rows) values.push({ ...r, amountBase: await toBase(r.amount, r.currency, r.date) });
  if (values.length) await db.insert(schema.adSpend).values(values);
  return values;
}

export async function addAdSpend(form: FormData) {
  const storeId = Number(str(form, "storeId")) || null;
  const base = {
    storeId,
    platform: str(form, "platform") || "Google Ads",
    account: str(form, "account") || null,
    currency: str(form, "currency").toUpperCase(),
    note: str(form, "note") || null,
  };
  const bulk = str(form, "bulk");
  if (bulk) {
    // One "YYYY-MM-DD amount CPC" per line; tab, semicolon or space separated. Extra columns are ignored.
    const rows = bulk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [date, amount, cpc] = l.split(/[\t; ]+/).map((v) => v.replace(",", "."));
        return { date, amount: Number(amount), cpc: Number(cpc) || null };
      })
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount));
    const added = await insertAdSpend(rows.map((r) => ({ ...base, ...r })));
    await logActivity({ area: "Ad spend", summary: `Pasted ${added.length} ad spend days (${base.currency})`, storeId, details: { rows: added.map((r) => ({ date: r.date, amount: r.amount, cpc: r.cpc })) } });
  } else {
    // "No ads" records the day as 0 so it stops showing as missing.
    const noAds = str(form, "noAds") === "1";
    const amount = noAds ? 0 : numOr(form, "amount");
    const cpc = noAds ? null : numOr(form, "cpc") || null;
    await insertAdSpend([{ ...base, date: str(form, "date"), amount, cpc }]);
    await logActivity({
      area: "Ad spend",
      summary: noAds ? `Marked ${str(form, "date")} as no ads` : `Added ad spend ${str(form, "date")}: ${amount} ${base.currency}${cpc ? `, CPC ${cpc}` : ""}`,
      storeId,
    });
  }
  revalidatePath("/", "layout");
}

/** Adds the missing CPC to an ad spend row that was entered or imported without one. */
export async function setAdSpendCpc(form: FormData) {
  const cpc = numOr(form, "cpc");
  if (!(cpc > 0)) return;
  const db = await getDb();
  const [row] = await db.update(schema.adSpend).set({ cpc }).where(eq(schema.adSpend.id, Number(str(form, "id")))).returning();
  if (row) await logActivity({ area: "Ad spend", summary: `Set CPC ${cpc} on ${row.date}`, storeId: row.storeId });
  revalidatePath("/", "layout");
}

/** Takes Google Ads' figures for the given days (one, or every day that differs). */
export async function takeGoogleAdsFigures(form: FormData) {
  const storeId = Number(str(form, "storeId"));
  const dates = form.getAll("date").map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!storeId) return;
  await applyGoogleFigures(storeId, dates);
  await logActivity({ area: "Ad spend", summary: `Took Google Ads figures for ${dates.length} day${dates.length === 1 ? "" : "s"}: ${dates.join(", ")}`, storeId });
  revalidatePath("/", "layout");
}

export async function deleteAdSpend(form: FormData) {
  const db = await getDb();
  const [row] = await db.delete(schema.adSpend).where(eq(schema.adSpend.id, Number(str(form, "id")))).returning();
  if (row) await logActivity({ area: "Ad spend", summary: `Deleted ad spend ${row.date}: ${row.amount} ${row.currency}`, storeId: row.storeId });
  revalidatePath("/", "layout");
}

// ---- Product costs ----

export async function setCost(form: FormData) {
  const db = await getDb();
  const sku = str(form, "sku");
  await db.insert(schema.productCosts).values({
    sku,
    unitCost: numOr(form, "unitCost"),
    currency: str(form, "currency").toUpperCase(),
    effectiveFrom: str(form, "effectiveFrom"),
    note: str(form, "note") || null,
    source: "manual",
  });
  await recomputeForSkus([sku]);
  await logActivity({ area: "Product costs", summary: `Set cost of ${sku}: ${numOr(form, "unitCost")} ${str(form, "currency").toUpperCase()} from ${str(form, "effectiveFrom")}` });
  revalidatePath("/", "layout");
}

export async function deleteCost(form: FormData) {
  const db = await getDb();
  const [row] = await db.delete(schema.productCosts).where(eq(schema.productCosts.id, Number(str(form, "id")))).returning();
  if (row) {
    await recomputeForSkus([row.sku]);
    await logActivity({ area: "Product costs", summary: `Deleted cost of ${row.sku}: ${row.unitCost} ${row.currency} from ${row.effectiveFrom}` });
  }
  revalidatePath("/", "layout");
}

// ---- Supplier quotes ----

export async function uploadQuote(form: FormData) {
  const read = await inputFromForm(form.get("file"), str(form, "text"));
  if (!read) return;
  const id = await importQuote(read.input, { source: "upload", filename: read.filename });
  await logActivity({ area: "Supplier quotes", summary: `Uploaded quote ${read.filename ?? "(pasted text)"}`, details: { quoteId: id } });
  revalidatePath("/quotes");
  redirect(`/quotes/${id}`);
}

export async function reviewQuote(form: FormData) {
  const db = await getDb();
  const importId = Number(str(form, "importId"));
  const items = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.importId, importId));
  // Apply SKU picks for lines Claude couldn't match.
  for (const it of items) {
    const pick = str(form, `sku_${it.id}`);
    if (pick && pick !== it.sku) await db.update(schema.quoteItems).set({ sku: pick }).where(eq(schema.quoteItems.id, it.id));
  }
  const approved = form.getAll("approve").map(Number);
  if (str(form, "intent") === "reject") {
    await db
      .update(schema.quoteItems)
      .set({ status: "rejected" })
      .where(and(eq(schema.quoteItems.importId, importId), eq(schema.quoteItems.status, "pending")));
  } else {
    await applyQuoteItems(approved, importId);
    const rejected = items.filter((i) => i.status === "pending" && !approved.includes(i.id)).map((i) => i.id);
    if (rejected.length) await db.update(schema.quoteItems).set({ status: "rejected" }).where(inArray(schema.quoteItems.id, rejected));
  }
  await db.update(schema.quoteImports).set({ status: "done" }).where(eq(schema.quoteImports.id, importId));
  await logActivity({
    area: "Supplier quotes",
    summary: str(form, "intent") === "reject" ? `Rejected quote #${importId}` : `Reviewed quote #${importId}: ${approved.length} price${approved.length === 1 ? "" : "s"} applied`,
    details: { quoteId: importId, approved },
  });
  revalidatePath("/", "layout");
}

// ---- Supplier invoices ----

export async function uploadInvoice(form: FormData) {
  const storeId = Number(str(form, "storeId"));
  const read = await inputFromForm(form.get("file"), str(form, "text"));
  if (!storeId || !read) return;
  const forDate = str(form, "forDate");
  const id = await importInvoice(read.input, storeId, read.filename, /^\d{4}-\d{2}-\d{2}$/.test(forDate) ? forDate : undefined);
  await logActivity({ area: "Invoices", summary: `Uploaded invoice ${read.filename ?? "(pasted text)"}`, storeId, details: { invoiceId: id } });
  revalidatePath("/", "layout");
  redirect(`/invoices/${id}`);
}

export async function reviewInvoice(form: FormData) {
  const invoiceId = Number(str(form, "invoiceId"));
  if (str(form, "intent") === "rematch") {
    // Order numbers typed for lines that didn't match; the page reloads with the new checks.
    const refs: string[] = [];
    for (const [key, value] of form.entries()) {
      const ref = String(value).trim();
      if (key.startsWith("ref_") && ref) {
        await rematchInvoiceOrder(Number(key.slice(4)), ref);
        refs.push(ref);
      }
    }
    await logActivity({ area: "Invoices", summary: `Invoice #${invoiceId}: re-matched ${refs.length} line${refs.length === 1 ? "" : "s"} (${refs.join(", ")})`, details: { invoiceId } });
  } else {
    const approved = str(form, "intent") === "reject" ? [] : form.getAll("approve").map(Number);
    await reviewInvoiceOrders(invoiceId, approved);
    await logActivity({ area: "Invoices", summary: approved.length ? `Invoice #${invoiceId}: approved ${approved.length} order${approved.length === 1 ? "" : "s"}` : `Invoice #${invoiceId}: rejected`, details: { invoiceId, approved } });
  }
  revalidatePath("/", "layout");
}

export async function removeInvoice(form: FormData) {
  await deleteInvoice(Number(str(form, "invoiceId")));
  await logActivity({ area: "Invoices", summary: `Deleted invoice #${str(form, "invoiceId")}` });
  revalidatePath("/", "layout");
  redirect("/invoices");
}

// ---- Business expenses ----

export async function addExpense(form: FormData) {
  const db = await getDb();
  const monthly = form.get("monthly") === "on";
  await db.insert(schema.expenses).values({
    date: str(form, "date"),
    category: str(form, "category") || "Other",
    description: str(form, "description") || null,
    amount: numOr(form, "amount"),
    currency: str(form, "currency").toUpperCase() || "USD",
    monthly,
    until: monthly && str(form, "until") ? str(form, "until") : null,
  });
  await logActivity({ area: "Expenses", summary: `Added ${monthly ? "monthly " : ""}expense ${str(form, "category") || "Other"}: ${numOr(form, "amount")} ${str(form, "currency").toUpperCase() || "USD"} from ${str(form, "date")}${str(form, "description") ? ` (${str(form, "description")})` : ""}` });
  revalidatePath("/", "layout");
}

export async function deleteExpense(form: FormData) {
  const db = await getDb();
  const [row] = await db.delete(schema.expenses).where(eq(schema.expenses.id, Number(str(form, "id")))).returning();
  if (row) await logActivity({ area: "Expenses", summary: `Deleted expense ${row.category}: ${row.amount} ${row.currency} (${row.date})` });
  revalidatePath("/", "layout");
}

export async function stopExpense(form: FormData) {
  // A monthly cost that ended: keep its history, stop it from the given date on.
  const db = await getDb();
  const [row] = await db.update(schema.expenses).set({ until: str(form, "until") }).where(eq(schema.expenses.id, Number(str(form, "id")))).returning();
  if (row) await logActivity({ area: "Expenses", summary: `Stopped monthly expense ${row.category} from ${str(form, "until")}` });
  revalidatePath("/", "layout");
}

// ---- Profit sheet import ----

export type SheetImportState = { results: ImportResult[]; unmatched: string[]; error?: string } | null;

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function importSheet(_: SheetImportState, form: FormData): Promise<SheetImportState> {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { results: [], unmatched: [], error: "Choose a sheet to upload." };
  const data = await file.arrayBuffer();
  const year = Number(str(form, "year")) || undefined;
  const storeId = Number(str(form, "storeId")) || null;
  const withExpenses = form.get("expenses") === "on";
  try {
    const stores = await listStores();
    const tabs = sheetTabs(data, file.name);
    // One store chosen: its tab (by name) or the only/first tab. Otherwise every tab named after a store.
    const pairs: [number, string | undefined][] = [];
    const unmatched: string[] = [];
    if (storeId) {
      const store = stores.find((s) => s.id === storeId)!;
      pairs.push([storeId, tabs.find((t) => nameKey(t) === nameKey(store.name)) ?? tabs[0]]);
    } else {
      for (const tab of tabs) {
        const store = stores.find((s) => nameKey(s.name) === nameKey(tab));
        if (store) pairs.push([store.id, tab]);
        else unmatched.push(tab);
      }
    }
    const results = [];
    for (const [id, tab] of pairs) results.push(await importProfitSheet(id, parseProfitSheet(data, file.name, year, tab), withExpenses));
    await logActivity({ area: "Sheet import", summary: `Imported old sheet ${file.name}: ${results.length} store${results.length === 1 ? "" : "s"}`, storeId, details: { results, unmatched } });
    revalidatePath("/", "layout");
    return { results, unmatched };
  } catch (e) {
    return { results: [], unmatched: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function undoSheetImport(form: FormData) {
  await undoProfitSheet(Number(str(form, "storeId")));
  await logActivity({ area: "Sheet import", summary: "Undid the old-sheet import", storeId: Number(str(form, "storeId")) });
  revalidatePath("/", "layout");
}

// ---- Ask ----

export async function askQuestion(history: AskTurn[]): Promise<AskResult> {
  try {
    return await ask(history);
  } catch (e) {
    return { answer: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, queries: [] };
  }
}
