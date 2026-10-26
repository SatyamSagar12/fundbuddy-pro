/**
 * Practice-scoped database access: the second wall behind the app's own filters.
 *
 * Every read or write of client data goes through `withPractice`. It opens a transaction, switches to the
 * restricted role `folio_app` and sets the scope. The row-level security policies (migrations 0001, 0003)
 * then refuse every row of any other practice, and, for a limited member (sub-broker), every client not
 * assigned to them. A query that forgets a filter returns nothing it shouldn't, instead of leaking it.
 */
import { sql } from "drizzle-orm";
import { db, type Db } from "./client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A practice id (full practice access, for system jobs and owners/staff), or a member's scope. */
export type Scope = string | { practiceId: string; userId: string; limited: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withPractice<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const s = typeof scope === "string" ? { practiceId: scope, userId: "", limited: false } : scope;
  if (!UUID.test(s.practiceId) || (s.userId && !UUID.test(s.userId))) throw new Error("Invalid scope");
  if (s.limited && !s.userId) throw new Error("A limited scope needs a user");
  return db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE folio_app`);
    await tx.execute(sql`SELECT set_config('app.practice_id', ${s.practiceId}, true),
                                set_config('app.user_id', ${s.userId}, true),
                                set_config('app.limited', ${s.limited ? "1" : "0"}, true)`);
    return fn(tx);
  });
}
