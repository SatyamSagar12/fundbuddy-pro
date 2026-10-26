/**
 * Practice-scoped database access: the second wall behind the app's own filters.
 *
 * Every read or write of client data goes through `withPractice`. It opens a transaction, switches to the
 * restricted role `folio_app` and sets `app.practice_id`. The row-level security policies in migration
 * 0001 then refuse every row of any other practice, so a query that forgets `where practice_id = ...`
 * returns nothing from another practice instead of leaking it.
 */
import { sql } from "drizzle-orm";
import { db, type Db } from "./client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withPractice<T>(practiceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(practiceId)) throw new Error("Invalid practice id");
  return db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE folio_app`);
    await tx.execute(sql`SELECT set_config('app.practice_id', ${practiceId}, true)`);
    return fn(tx);
  });
}
