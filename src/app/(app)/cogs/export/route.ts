import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { cogsDay } from "@/lib/cogs-check";

const cell = (v: string | number | null) => {
  const s = v == null ? "" : typeof v === "number" ? v.toFixed(2) : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The cost of goods check of one store's day as a CSV, for Excel or Google Sheets. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const date = q.get("date") ?? "";
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, Number(q.get("store"))));
  if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Not found", { status: 404 });
  const day = await cogsDay(store, date);
  const c = day.currency;
  const lines = [
    ["Order", "Time", "Products", `Sold for (${c}, excl. VAT)`, `Refunded (${c})`, `Supplier products (${c})`, `Supplier shipping (${c})`, `Supplier other (${c})`, `Cost of goods (${c})`, "COG %", "From"],
    ...day.orders.map((o) => [o.name, o.time, o.products, o.soldFor, o.refunded, o.productCost, o.shippingCost, o.otherCost, o.source === "missing" ? null : o.cost, o.soldFor && o.source !== "missing" ? `${((o.cost / o.soldFor) * 100).toFixed(1)}%` : "", o.source]),
    ["Day total", "", "", day.soldFor, null, null, null, null, day.cost, day.soldFor ? `${((day.cost / day.soldFor) * 100).toFixed(1)}%` : "", day.dayWise ? "old sheet (day)" : ""],
  ];
  const name = `${store.name.replace(/[^\w-]+/g, "-")}-cogs-${date}.csv`;
  return new Response(lines.map((l) => l.map(cell).join(",")).join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
