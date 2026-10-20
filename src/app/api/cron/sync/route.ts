import { isCronRequest } from "@/lib/auth";
import { syncStores } from "@/lib/sync";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ results: await syncStores() });
}
