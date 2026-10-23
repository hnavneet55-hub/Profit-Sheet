import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";
import { today } from "@/lib/dates";

export type ActivitySource = "user" | "script" | "api" | "cron";

type Entry = {
  area: string;
  summary: string;
  source?: ActivitySource;
  /** Defaults to the signed-in user for source "user". */
  actor?: string;
  storeId?: number | null;
  details?: Record<string, unknown>;
};

/** Records one change in the activity log. Never throws: a logging problem must not break the change itself. */
export async function logActivity(e: Entry): Promise<void> {
  try {
    const source = e.source ?? "user";
    let actor = e.actor;
    if (!actor) actor = source === "user" ? ((await sessionUser((await cookies()).get(SESSION_COOKIE)?.value)) ?? "Local user") : source;
    const db = await getDb();
    let storeName: string | null = null;
    if (e.storeId) {
      const [s] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, e.storeId));
      storeName = s?.name ?? null;
    }
    await db.insert(schema.activityLog).values({
      day: today(),
      source,
      actor,
      area: e.area,
      summary: e.summary,
      storeId: e.storeId ?? null,
      storeName,
      details: e.details ?? null,
    });
  } catch (err) {
    console.error("activity log failed", err);
  }
}
