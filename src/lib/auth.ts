// Logins: the main DASHBOARD_USER / DASHBOARD_PASSWORD, plus anyone in DASHBOARD_EXTRA_USERS
// ("user:password,user:password"). The session cookie is the user ID and an HMAC of their
// password, so changing someone's password (or removing them) signs only them out.
export const SESSION_COOKIE = "ps_session";

type Account = { user: string; password: string };

export function accounts(): Account[] {
  const main = { user: process.env.DASHBOARD_USER ?? "", password: process.env.DASHBOARD_PASSWORD ?? "" };
  const extra = (process.env.DASHBOARD_EXTRA_USERS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => ({ user: e.slice(0, e.indexOf(":")).trim(), password: e.slice(e.indexOf(":") + 1) }))
    .filter((a) => a.user && a.password);
  return main.password ? [main, ...extra] : extra;
}

/** The account these login details belong to; user IDs ignore upper/lower case. */
export function findAccount(user: string, password: string): Account | undefined {
  return accounts().find((a) => a.user.toLowerCase() === user.trim().toLowerCase() && a.password === password);
}

async function sign(a: Account): Promise<string> {
  const secret = process.env.APP_SECRET ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`session:${a.user}:${a.password}`));
  return Buffer.from(sig).toString("base64url");
}

export async function sessionToken(a: Account): Promise<string> {
  return `${Buffer.from(a.user).toString("base64url")}.${await sign(a)}`;
}

/** The signed-in user ID, or null when the cookie is missing or no longer valid. */
export async function sessionUser(cookie: string | undefined): Promise<string | null> {
  const [u, sig] = (cookie ?? "").split(".");
  if (!u || !sig) return null;
  const user = Buffer.from(u, "base64url").toString();
  const a = accounts().find((x) => x.user === user);
  return a && (await sign(a)) === sig ? user : null;
}

export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}
