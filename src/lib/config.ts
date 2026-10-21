export const BASE_CURRENCY = (process.env.BASE_CURRENCY ?? "USD").toUpperCase();
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";
export const CLAUDE_MODEL = "claude-opus-5-5";
// Orders older than this many days without any cost are no longer flagged.
export const MISSING_COST_DAYS = 60;

// Target cost of goods by niche, as % of sales; shown on the cost of goods check.
export const COGS_TARGETS: { niche: string; target: string }[] = [
  { niche: "Fashion", target: "33% on average" },
  { niche: "Home & decor: lamps", target: "40–45%" },
  { niche: "Home & decor: everything else", target: "37–40%, depends a bit on the product" },
  { niche: "Gadgets", target: "33%" },
  { niche: "Kids' toys", target: "35%" },
];
