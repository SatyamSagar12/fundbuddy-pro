/**
 * The database itself must keep practices apart, even when the app's own query forgets to filter.
 * Needs the local test database: scripts/local-db.sh, then DATABASE_URL=...folio_test npm run db:migrate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { auditLog, investors, practices, users } from "@/server/db/schema";
import { expectDbError, withTestDb } from "./helpers";

let A = "";
let B = "";

beforeAll(() =>
  withTestDb(async () => {
    const rows = await db()
      .insert(practices)
      .values([
        { name: "RLS test A", dataKeyWrapped: "x" },
        { name: "RLS test B", dataKeyWrapped: "x" },
      ])
      .returning({ id: practices.id });
    A = rows[0]!.id;
    B = rows[1]!.id;
    await withPractice(A, (tx) => tx.insert(investors).values({ practiceId: A, name: "Client of A" }));
    await withPractice(B, (tx) => tx.insert(investors).values({ practiceId: B, name: "Client of B" }));
  }),
);

afterAll(() => withTestDb(async () => void (await db().delete(practices).where(sql`name like 'RLS test %'`))));

describe("row-level security", () => {
  it("shows a practice only its own clients, even with no filter in the query", async () => {
    const names = await withTestDb(() => withPractice(A, (tx) => tx.select({ name: investors.name }).from(investors)));
    expect(names.map((n) => n.name)).toEqual(["Client of A"]);
  });

  it("refuses to write a row into another practice", async () => {
    await expectDbError(withTestDb(() => withPractice(A, (tx) => tx.insert(investors).values({ practiceId: B, name: "Sneaky" }))), /row-level security/);
  });

  it("cannot update or delete another practice's rows", async () => {
    await withTestDb(async () => {
      const updated = await withPractice(A, (tx) =>
        tx.update(investors).set({ name: "Hacked" }).where(eq(investors.practiceId, B)).returning(),
      );
      expect(updated).toHaveLength(0);
      const deleted = await withPractice(A, (tx) => tx.delete(investors).where(eq(investors.practiceId, B)).returning());
      expect(deleted).toHaveLength(0);
    });
  });

  it("sees nothing when no practice is set (fails closed)", async () => {
    const rows = await withTestDb(() =>
      db().transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE folio_app`);
        return tx.select().from(investors);
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot read account tables from a practice scope", async () => {
    await expectDbError(withTestDb(() => withPractice(A, (tx) => tx.select().from(users))), /permission denied/);
    await expectDbError(withTestDb(() => withPractice(A, (tx) => tx.select().from(practices))), /permission denied/);
  });

  it("keeps the audit log append-only", async () => {
    await withTestDb(() => withPractice(A, (tx) => tx.insert(auditLog).values({ practiceId: A, action: "test" })));
    await expectDbError(withTestDb(() => withPractice(A, (tx) => tx.update(auditLog).set({ action: "changed" }))), /permission denied/);
    await expectDbError(withTestDb(() => withPractice(A, (tx) => tx.delete(auditLog))), /permission denied/);
  });

  it("has row-level security switched on for every table", async () => {
    const off = await withTestDb(() =>
      db().execute(
        sql`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity and relname <> '__drizzle_migrations'`,
      ),
    );
    expect([...off]).toEqual([]);
  });
});
