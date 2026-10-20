// Applies pending migrations to DATABASE_URL. Runs before `next build`.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// The direct (unpooled) connection is safer for migrations behind Neon's pooler.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL not set, skipping migrations (local dev migrates on startup).");
  process.exit(0);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: "drizzle" });
await client.end();
console.log("Migrations applied.");
