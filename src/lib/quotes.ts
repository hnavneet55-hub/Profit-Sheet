import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, readOnlyQuery, schema } from "@/db";
import { EXTRACT_MODEL } from "./config";
import { currentCostBase, recomputeForSkus } from "./costs";
import { toBase } from "./fx";
import { today } from "./dates";
import { supplierContent, type SupplierInput } from "./supplier-files";

const PRICE_CHANGE_FLAG_PCT = 15;

const QuoteSchema = z.object({
  supplier: z.string().nullable().describe("Supplier name if stated"),
  summary: z.string().describe("One or two sentences on what this quote contains"),
  items: z.array(
    z.object({
      supplier_ref: z.string().describe("The product exactly as the supplier wrote it (SKU, name, variant)"),
      matched_sku: z
        .string()
        .nullable()
        .describe("SKU from our catalogue this line is for, or null if no confident match"),
      unit_cost: z.number().describe("Cost per single unit, including per-unit shipping if the quote bundles it"),
      currency: z.string().describe("ISO 4217 code, e.g. USD, EUR, CNY"),
      effective_from: z.string().nullable().describe("YYYY-MM-DD the price applies from, if stated"),
      notes: z.array(z.string()).describe("Problems a human should check: ambiguity, tiered prices, missing currency, etc."),
    }),
  ),
});

async function catalogue(): Promise<string> {
  // Every SKU seen in orders or given a cost, with its most common name.
  const rows = await readOnlyQuery(`
    select s.sku, (select l.name from order_lines l where l.sku = s.sku group by l.name order by count(*) desc limit 1) as name
    from (select sku from order_lines union select sku from product_costs) s
    order by s.sku`);
  return rows.map((r) => `${r.sku}\t${r.name ?? ""}`).join("\n");
}

const SYSTEM = `You read supplier price quotes for an e-commerce business and turn them into per-unit product costs.

Rules:
- Extract one item per product/variant price. If a quote has quantity tiers, use the tier for the smallest order quantity and add a note listing the other tiers.
- Match each line to a SKU from the catalogue only when you are confident; otherwise matched_sku is null and add a note.
- unit_cost is per single sellable unit. If shipping is quoted per unit, include it and say so in notes; if shipping is quoted per shipment, leave it out and note it.
- Never guess a currency silently. If none is stated, use the most likely one and add a note saying it was assumed.
- If something in the quote looks wrong (a price far from similar items, a unit mismatch like per-dozen vs per-piece, totals that don't add up), add a note.`;

async function extract(input: SupplierInput) {
  const client = new Anthropic();
  const content = supplierContent(input, `Our product catalogue (SKU<TAB>name):\n${await catalogue()}\n\nToday is ${today()}.`, "supplier quote");

  // Streamed: long outputs exceed the SDK's limit for a single non-streaming request.
  const res = await client.beta.messages
    .stream({
      model: EXTRACT_MODEL,
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: zodOutputFormat(QuoteSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new Error("Claude declined to process this quote.");
  if (res.stop_reason === "max_tokens") throw new Error("The quote is too long to read in one pass. Split it and try again.");
  if (!res.parsed_output) throw new Error("Claude's answer could not be read. Try again.");
  return res.parsed_output;
}

/** Reads a quote with Claude and stores the proposed cost changes for review. */
export async function importQuote(input: SupplierInput, meta: { source: "upload"; filename?: string }): Promise<number> {
  const db = await getDb();
  const [imp] = await db
    .insert(schema.quoteImports)
    .values({ ...meta, status: "processing" })
    .returning({ id: schema.quoteImports.id });

  try {
    const parsed = await extract(input);
    const date = today();
    const known = new Set((await catalogue()).split("\n").map((l) => l.split("\t")[0]));
    const seen = new Map<string, number>();

    const items = [];
    for (const it of parsed.items) {
      const flags = [...it.notes];
      const sku = it.matched_sku && known.has(it.matched_sku) ? it.matched_sku : null;
      if (it.matched_sku && !sku) flags.push(`Claude suggested SKU "${it.matched_sku}", which isn't in the catalogue`);
      if (!sku) flags.push("No matching SKU: pick one before approving");
      const currency = it.currency.toUpperCase();
      let newCostBase: number | null = null;
      try {
        newCostBase = await toBase(it.unit_cost, currency, date);
      } catch {
        flags.push(`Unknown currency ${currency}`);
      }
      let previousCostBase: number | null = null;
      if (sku) {
        previousCostBase = await currentCostBase(sku, date);
        if (previousCostBase == null) flags.push("First cost for this SKU");
        else if (newCostBase != null && previousCostBase > 0) {
          const change = ((newCostBase - previousCostBase) / previousCostBase) * 100;
          if (Math.abs(change) >= PRICE_CHANGE_FLAG_PCT) flags.push(`Price ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% vs current cost`);
        }
        if (seen.has(sku)) flags.push("SKU appears more than once in this quote");
        seen.set(sku, (seen.get(sku) ?? 0) + 1);
      }
      if (it.unit_cost <= 0) flags.push("Price is zero or negative");
      items.push({
        importId: imp.id,
        supplierRef: it.supplier_ref,
        sku,
        unitCost: it.unit_cost,
        currency,
        effectiveFrom: it.effective_from && /^\d{4}-\d{2}-\d{2}$/.test(it.effective_from) ? it.effective_from : date,
        previousCostBase,
        newCostBase,
        flags,
      });
    }
    if (items.length) await db.insert(schema.quoteItems).values(items);
    await db
      .update(schema.quoteImports)
      .set({ status: "pending", summary: parsed.summary, supplier: parsed.supplier })
      .where(eq(schema.quoteImports.id, imp.id));
  } catch (e) {
    await db
      .update(schema.quoteImports)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .where(eq(schema.quoteImports.id, imp.id));
  }
  return imp.id;
}

/** Applies approved items as new cost rows and recalculates affected orders. */
export async function applyQuoteItems(itemIds: number[], importId: number): Promise<number> {
  const db = await getDb();
  const items = await db.select().from(schema.quoteItems).where(eq(schema.quoteItems.importId, importId));
  const skus: string[] = [];
  for (const it of items) {
    if (!itemIds.includes(it.id) || !it.sku || it.status !== "pending") continue;
    await db.insert(schema.productCosts).values({
      sku: it.sku,
      unitCost: it.unitCost,
      currency: it.currency,
      effectiveFrom: it.effectiveFrom,
      source: "supplier_sheet",
      sourceRef: importId,
      note: it.supplierRef,
    });
    await db.update(schema.quoteItems).set({ status: "approved" }).where(eq(schema.quoteItems.id, it.id));
    skus.push(it.sku);
  }
  return recomputeForSkus(skus);
}
