import "server-only";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

type RawQuery = (text: string) => Promise<Record<string, unknown>[]>;
const g = globalThis as unknown as { __db?: Promise<DB>; __readOnly?: RawQuery };

// Production uses DATABASE_URL (Neon via the Vercel Marketplace). Without it,
// local development falls back to an embedded Postgres (PGlite) in .data/.
async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { prepare: false, max: 5 });
    g.__readOnly = (text) =>
      client.begin("read only", async (tx) => {
        await tx.unsafe("set local statement_timeout = '15s'");
        return [...(await tx.unsafe(text))] as Record<string, unknown>[];
      }) as Promise<Record<string, unknown>[]>;
    return drizzlePg(client, { schema });
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Connect a Postgres database to this project.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data", { recursive: true });
  const client = new PGlite(".data/pglite");
  const db = drizzleLite(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  g.__readOnly = (text) =>
    client.transaction(async (tx) => {
      await tx.query("set transaction read only");
      return (await tx.query<Record<string, unknown>>(text)).rows;
    });
  // Same query API; the cast keeps one DB type across the app.
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  g.__db ??= connect();
  return g.__db;
}

/** Runs one SQL statement in a read-only transaction (for the Ask page). */
export async function readOnlyQuery(text: string): Promise<Record<string, unknown>[]> {
  await getDb();
  return g.__readOnly!(text);
}

export { schema };
