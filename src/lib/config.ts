export const BASE_CURRENCY = (process.env.BASE_CURRENCY ?? "USD").toUpperCase();
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";
export const CLAUDE_MODEL = "claude-opus-5-5";
// Orders older than this many days without any cost are no longer flagged.
export const MISSING_COST_DAYS = 60;
