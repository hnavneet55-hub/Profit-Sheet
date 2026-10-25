import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!process.env.DASHBOARD_PASSWORD) {
    // Allow open access only in local development.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Set DASHBOARD_PASSWORD and APP_SECRET to use the dashboard.", { status: 503 });
  }
  if (await sessionUser(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Cron routes check CRON_SECRET themselves; the Google Ads import checks its per-store token;
  // the cost export for AdProfit checks COGS_EXPORT_KEY.
  matcher: ["/((?!login|api/cron|api/ads|api/export|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
