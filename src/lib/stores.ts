import "server-only";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";

export async function listStores() {
  const db = await getDb();
  return db.select().from(schema.stores).orderBy(asc(schema.stores.name));
}
