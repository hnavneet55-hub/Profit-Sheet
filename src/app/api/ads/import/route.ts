import { z } from "zod";
import { importAdsDays, validAdsToken } from "@/lib/ads-script";

const Body = z.object({
  storeId: z.number().int().positive(),
  token: z.string(),
  currency: z.string().length(3),
  account: z.string().nullish(),
  days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost: z.number().min(0), clicks: z.number().min(0) })).max(93),
});

/** Called by each store's Google Ads script with the last few days of cost and clicks. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const b = parsed.data;
  if (!validAdsToken(b.storeId, b.token)) return new Response("Wrong store ID or token", { status: 401 });
  try {
    return Response.json(await importAdsDays(b.storeId, b.currency.toUpperCase(), b.account ?? null, b.days));
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Failed", { status: 422 });
  }
}
