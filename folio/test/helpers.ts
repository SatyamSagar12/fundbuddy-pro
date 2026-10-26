import { runWithDb } from "@/server/db/client";

export const TEST_DB_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio_test";

/** Runs fn with a database context on the test database, then closes the connection. */
export async function withTestDb<T>(fn: () => Promise<T>): Promise<T> {
  const { result, close } = await runWithDb(TEST_DB_URL, fn);
  await close();
  return result;
}

/** Asserts the promise fails with a Postgres error whose message matches (Drizzle wraps it in `cause`). */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    if (!pattern.test(message)) throw new Error(`Expected ${pattern}, got: ${message}`);
    return;
  }
  throw new Error(`Expected a database error matching ${pattern}, but it succeeded`);
}
