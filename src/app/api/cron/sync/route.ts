import { isCronRequest } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { syncStores } from "@/lib/sync";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  const results = await syncStores();
  const orders = results.reduce((n, r) => n + r.orders, 0);
  const failed = results.filter((r) => r.error);
  await logActivity({
    source: "cron",
    actor: "Hourly sync",
    area: "Sync",
    summary: `Hourly sync: ${orders} orders across ${results.length} stores${failed.length ? `; errors: ${failed.map((r) => `${r.store} (${r.error})`).join("; ")}` : ""}`,
    details: { results },
  });
  return Response.json({ results });
}
