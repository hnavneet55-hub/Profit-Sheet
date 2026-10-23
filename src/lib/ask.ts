import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readOnlyQuery } from "@/db";
import { BASE_CURRENCY, CLAUDE_MODEL } from "./config";
import { REPORT_TIMEZONE, today } from "./dates";

const MAX_ROWS = 200;
const HIDDEN_COLUMNS = /(_enc$|^client_id$)/;

const SYSTEM = `You answer questions about an e-commerce business that runs about 10 Shopify stores. You have read-only SQL access (PostgreSQL) to the data synced from the stores. Query the data to answer; never guess numbers.

Tables (amounts ending _base are in ${BASE_CURRENCY}, converted with the rate locked for that day):
- stores(id, name, shop_domain, currency, reporting_currency, payment_fee_pct, payment_fee_fixed, platform_fee_pct, media_buyer_fee_pct, active, last_synced_at)
- orders(id, store_id, name, created_at, order_date, currency, cancelled, total_price, total_tax, net_revenue, reported_fees, gateways, chargeback (bool), chargeback_status, inquiry (bool), fx_rate, net_revenue_base, fees_base, cogs_base, cogs_missing)
  total_price/total_tax/net_revenue are in the store's currency; net_revenue = total_price - total_tax (excl. VAT, incl. shipping, after discounts). Exclude cancelled orders from order counts.
- order_lines(id, order_id, sku, name, quantity, unit_cost_base)
- refunds(id, order_id, store_id, created_at, refund_date, amount, amount_net, amount_base, restocked_qty)
  amount is incl. VAT in store currency; amount_net excl. VAT; amount_base = amount_net in ${BASE_CURRENCY}. Refunds count on refund_date.
- refund_lines(refund_id, order_id, sku, name, quantity, subtotal, restock_type)  -- which products were refunded/returned; restock_type RETURN means the item came back
- ad_spend(id, date, store_id, platform, account, currency, amount, amount_base, note)
- product_costs(sku, unit_cost, currency, effective_from, source, note)  -- cost of goods history
- fx_rates(date, currency, rate)  -- units of currency per 1 ${BASE_CURRENCY}; to show a _base amount in a store's reporting currency multiply by the rate for that date.

Profit for a period = sum(net_revenue_base by order_date) - sum(refunds.amount_base by refund_date) - sum(cogs_base) - sum(ad_spend.amount_base) - media buyer fee (ad spend x media_buyer_fee_pct/100 per store) - sum(fees_base).

Dates are calendar days in ${REPORT_TIMEZONE}. Today is ${today()}.
Answer concisely: lead with the answer, then a small markdown table if it helps. State the currency for every amount. If data looks incomplete (for example orders with cogs_missing, or days with no ad spend), say so.`;

export type AskTurn = { role: "user" | "assistant"; content: string };
export type AskResult = { answer: string; queries: string[] };

export async function ask(history: AskTurn[]): Promise<AskResult> {
  const client = new Anthropic();
  const queries: string[] = [];

  const runSql = betaZodTool({
    name: "run_sql",
    description: `Run one read-only PostgreSQL SELECT statement and get up to ${MAX_ROWS} rows back as JSON. Aggregate in SQL rather than fetching raw rows.`,
    inputSchema: z.object({ sql: z.string().describe("A single SELECT (or WITH ... SELECT) statement") }),
    run: async ({ sql }) => {
      queries.push(sql);
      try {
        const rows = await readOnlyQuery(sql);
        const clean = rows.slice(0, MAX_ROWS).map((r) =>
          Object.fromEntries(Object.entries(r).filter(([k]) => !HIDDEN_COLUMNS.test(k))),
        );
        const more = rows.length > MAX_ROWS ? `\n(${rows.length - MAX_ROWS} more rows not shown; aggregate or add a LIMIT)` : "";
        return JSON.stringify(clean) + more;
      } catch (e) {
        return `SQL error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  const final = await client.beta.messages.toolRunner({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [runSql],
    messages: history.map((t) => ({ role: t.role, content: t.content })),
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_iterations: 12,
  });

  if (final.stop_reason === "refusal") return { answer: "Claude declined to answer this question.", queries };
  const answer = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { answer: answer || "No answer was produced. Try rephrasing the question.", queries };
}
