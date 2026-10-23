import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { adsDaysToSend, importAdsDays, validAdsToken } from "@/lib/ads-script";

const Body = z.object({
  storeId: z.number().int().positive(),
  token: z.string(),
  currency: z.string().length(3),
  account: z.string().nullish(),
  days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost: z.number().min(0), clicks: z.number().min(0) })).max(93),
});

/** The script asks first how many days to send: 30 on its first run, then the days since its last report. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const storeId = Number(q.get("storeId"));
  if (!storeId || !validAdsToken(storeId, q.get("token") ?? "")) return new Response("Wrong store ID or token", { status: 401 });
  return Response.json({ days: await adsDaysToSend(storeId) });
}

/** Called by each store's Google Ads script with the days' cost and clicks. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const b = parsed.data;
  if (!validAdsToken(b.storeId, b.token)) return new Response("Wrong store ID or token", { status: 401 });
  try {
    const result = await importAdsDays(b.storeId, b.currency.toUpperCase(), b.account ?? null, b.days);
    await logActivity({
      source: "script",
      actor: "Google Ads script",
      area: "Ad spend",
      summary: `Google Ads script reported ${b.days.length} day${b.days.length === 1 ? "" : "s"}${b.days.length ? ` (${b.days[0].date} to ${b.days[b.days.length - 1].date})` : ""}`,
      storeId: b.storeId,
      details: { account: b.account ?? null, currency: b.currency, result },
    });
    return Response.json(result);
  } catch (e) {
    await logActivity({ source: "script", actor: "Google Ads script", area: "Ad spend", summary: `Google Ads script report failed: ${e instanceof Error ? e.message : "Failed"}`, storeId: b.storeId });
    return new Response(e instanceof Error ? e.message : "Failed", { status: 422 });
  }
}
