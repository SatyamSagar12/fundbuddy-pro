/**
 * One database connection per request.
 *
 * On Cloudflare, connections go through Hyperdrive, which pools them near the database. A connection
 * cannot be shared between requests, so src/server.ts opens a context per request with `runWithDb`
 * and closes it when the response is done. Scripts and tests do the same with a plain URL.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

type Holder = { url: string; client?: postgres.Sql; db?: Db };
const store = new AsyncLocalStorage<Holder>();

export async function runWithDb<T>(url: string, fn: () => Promise<T>): Promise<{ result: T; close: () => Promise<void> }> {
  const holder: Holder = { url };
  const result = await store.run(holder, fn);
  return { result, close: async () => void (await holder.client?.end({ timeout: 5 })) };
}

/** The database as its owner: account tables, shared data, system jobs. Never for client data. */
export function db(): Db {
  const holder = store.getStore();
  if (!holder) throw new Error("db() called outside a request context");
  if (!holder.db) {
    // fetch_types: false avoids an extra round trip on every new connection (recommended for Hyperdrive).
    holder.client = postgres(holder.url, { max: 5, fetch_types: false, prepare: true, onnotice: () => {} });
    holder.db = drizzle(holder.client, { schema });
  }
  return holder.db;
}
