// Single shared password for the team. The session cookie is an HMAC of the
// password, so changing DASHBOARD_PASSWORD signs everyone out.
export const SESSION_COOKIE = "ps_session";

export async function sessionToken(): Promise<string> {
  const secret = process.env.APP_SECRET ?? "";
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`session:${password}`));
  return Buffer.from(sig).toString("base64url");
}

export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}
