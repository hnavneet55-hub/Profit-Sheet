"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { toBase } from "@/lib/fx";
import { recomputeForSkus, recomputeForStore } from "@/lib/costs";
import { syncStores } from "@/lib/sync";
import { applyQuoteItems, importQuote } from "@/lib/quotes";
import { deleteInvoice, importInvoice, rematchInvoiceOrder, reviewInvoiceOrders } from "@/lib/invoices";
import { inputFromForm } from "@/lib/supplier-files";
import { ask, type AskTurn, type AskResult } from "@/lib/ask";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOr = (f: FormData, k: string, d = 0) => {
  const v = str(f, k).replace(",", ".");
  return v === "" ? d : Number(v);
};

// ---- Login ----

export async function login(_: string | null, form: FormData): Promise<string | null> {
  if (str(form, "password") !== process.env.DASHBOARD_PASSWORD) return "Wrong password";
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  const next = str(form, "next");
  redirect(next.startsWith("/") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
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
  } else {
    await db.insert(schema.stores).values(values as typeof schema.stores.$inferInsert);
  }
  revalidatePath("/", "layout");
  redirect("/stores");
}

export async function deleteStore(form: FormData) {
  const db = await getDb();
  await db.delete(schema.stores).where(eq(schema.stores.id, Number(str(form, "id"))));
  revalidatePath("/", "layout");
  redirect("/stores");
}

export async function syncNow(form: FormData) {
  const id = Number(str(form, "id")) || undefined;
  await syncStores(id ? [id] : undefined);
  revalidatePath("/", "layout");
}

// ---- Ad spend ----

async function insertAdSpend(rows: { date: string; storeId: number | null; platform: string; account: string | null; currency: string; amount: number; note: string | null }[]) {
  const db = await getDb();
  const values = [];
  for (const r of rows) values.push({ ...r, amountBase: await toBase(r.amount, r.currency, r.date) });
  if (values.length) await db.insert(schema.adSpend).values(values);
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
    // One "YYYY-MM-DD amount" per line; tab, comma, semicolon or space separated.
    const rows = bulk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [date, amount] = l.split(/[\t;, ]+/);
        return { date, amount: Number(amount) };
      })
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount));
    await insertAdSpend(rows.map((r) => ({ ...base, ...r })));
  } else {
    await insertAdSpend([{ ...base, date: str(form, "date"), amount: numOr(form, "amount") }]);
  }
  revalidatePath("/", "layout");
}

export async function deleteAdSpend(form: FormData) {
  const db = await getDb();
  await db.delete(schema.adSpend).where(eq(schema.adSpend.id, Number(str(form, "id"))));
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
  revalidatePath("/", "layout");
}

export async function deleteCost(form: FormData) {
  const db = await getDb();
  const [row] = await db.delete(schema.productCosts).where(eq(schema.productCosts.id, Number(str(form, "id")))).returning();
  if (row) await recomputeForSkus([row.sku]);
  revalidatePath("/", "layout");
}

// ---- Supplier quotes ----

export async function uploadQuote(form: FormData) {
  const read = await inputFromForm(form.get("file"), str(form, "text"));
  if (!read) return;
  const id = await importQuote(read.input, { source: "upload", filename: read.filename });
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
  revalidatePath("/", "layout");
}

// ---- Supplier invoices ----

export async function uploadInvoice(form: FormData) {
  const storeId = Number(str(form, "storeId"));
  const read = await inputFromForm(form.get("file"), str(form, "text"));
  if (!storeId || !read) return;
  const id = await importInvoice(read.input, storeId, read.filename);
  revalidatePath("/", "layout");
  redirect(`/invoices/${id}`);
}

export async function reviewInvoice(form: FormData) {
  const invoiceId = Number(str(form, "invoiceId"));
  if (str(form, "intent") === "rematch") {
    // Order numbers typed for lines that didn't match; the page reloads with the new checks.
    for (const [key, value] of form.entries()) {
      const ref = String(value).trim();
      if (key.startsWith("ref_") && ref) await rematchInvoiceOrder(Number(key.slice(4)), ref);
    }
  } else {
    await reviewInvoiceOrders(invoiceId, str(form, "intent") === "reject" ? [] : form.getAll("approve").map(Number));
  }
  revalidatePath("/", "layout");
}

export async function removeInvoice(form: FormData) {
  await deleteInvoice(Number(str(form, "invoiceId")));
  revalidatePath("/", "layout");
  redirect("/invoices");
}

// ---- Ask ----

export async function askQuestion(history: AskTurn[]): Promise<AskResult> {
  try {
    return await ask(history);
  } catch (e) {
    return { answer: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, queries: [] };
  }
}
