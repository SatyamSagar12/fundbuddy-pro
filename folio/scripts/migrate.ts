/**
 * Applies db/migrations to DATABASE_URL (default: the local dev database).
 * Production: run from your own computer or the deploy workflow with Supabase's *session pooler* URL.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio";
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
await client.end();
console.log(`Migrations applied to ${new URL(url).host}${new URL(url).pathname}`);
