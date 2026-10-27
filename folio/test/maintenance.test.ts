/** The app's own migration runner (used on Cloudflare Pages) matches drizzle-kit's records. */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, runWithDb } from "@/server/db/client";
import { migrate } from "@/server/maintenance";
import { TEST_DB_URL } from "./helpers";

// An empty database: create with `createdb -O folio_owner folio_mig` (CI and scripts/local-db.sh do).
const FRESH = TEST_DB_URL.replace(/\/[^/]+$/, "/folio_mig");

async function on<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const { result, close } = await runWithDb(url, fn);
  await close();
  return result;
}

const records = () =>
  db().execute<{ hash: string; created_at: string }>(sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`);

describe("runtime migrations", () => {
  it("builds a fresh database, then has nothing left to apply", async () => {
    await on(FRESH, async () => {
      await db().execute(sql`drop schema if exists drizzle cascade`);
      await db().execute(sql`drop schema public cascade`);
      await db().execute(sql`create schema public`);
    });
    const first = await on(FRESH, () => migrate());
    expect(first[0]).toBe("0000_init");
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(await on(FRESH, () => migrate())).toEqual([]);
    const rls = await on(FRESH, () =>
      db().execute(sql`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`),
    );
    expect([...rls][0]).toEqual({ n: 0 });
  });

  it("records the same hashes as drizzle-kit's migrator", async () => {
    const mine = [...(await on(FRESH, records))];
    const theirs = [...(await on(TEST_DB_URL, records))];
    expect(mine).toEqual(theirs);
  });
});
