/** A limited member (sub-broker) sees only clients assigned to them, enforced by the database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { investors, practices, sips, transactions, users } from "@/server/db/schema";
import { expectDbError, withTestDb } from "./helpers";

let P = "";
let sub = "";
let other = "";
let mine = "";
let theirs = "";

beforeAll(() =>
  withTestDb(async () => {
    const [p] = await db().insert(practices).values({ name: "Subbroker test", dataKeyWrapped: "x" }).returning();
    P = p!.id;
    const u = await db()
      .insert(users)
      .values([
        { email: `sub-${P}@example.com`, name: "Sub", passwordHash: "x" },
        { email: `other-${P}@example.com`, name: "Other", passwordHash: "x" },
      ])
      .returning();
    sub = u[0]!.id;
    other = u[1]!.id;
    await withPractice(P, async (tx) => {
      const rows = await tx
        .insert(investors)
        .values([
          { practiceId: P, name: "Mine", assignedUserId: sub },
          { practiceId: P, name: "Theirs", assignedUserId: other },
        ])
        .returning();
      mine = rows[0]!.id;
      theirs = rows[1]!.id;
      for (const id of [mine, theirs]) {
        await tx.insert(transactions).values({ practiceId: P, investorId: id, type: "sip", tradeDate: "2026-01-01", amount: "100", source: "manual" });
        await tx.insert(sips).values({ practiceId: P, investorId: id, amount: "100", frequency: "monthly", startDate: "2026-01-01", status: "active", source: "manual" });
      }
    });
  }),
);

afterAll(() =>
  withTestDb(async () => {
    await db().delete(practices).where(eq(practices.id, P));
    await db().delete(users).where(eq(users.id, sub));
    await db().delete(users).where(eq(users.id, other));
  }),
);

const subScope = () => ({ practiceId: P, userId: sub, limited: true });

describe("sub-broker scope", () => {
  it("sees only their own clients, transactions and SIPs", async () => {
    const seen = await withTestDb(() =>
      withPractice(subScope(), async (tx) => ({
        investors: (await tx.select().from(investors)).map((r) => r.name),
        transactions: (await tx.select().from(transactions)).map((r) => r.investorId),
        sips: (await tx.select().from(sips)).map((r) => r.investorId),
      })),
    );
    expect(seen).toEqual({ investors: ["Mine"], transactions: [mine], sips: [mine] });
  });

  it("an unlimited member of the same practice sees everyone", async () => {
    const n = await withTestDb(() =>
      withPractice({ practiceId: P, userId: other, limited: false }, async (tx) => (await tx.select().from(investors)).length),
    );
    expect(n).toBe(2);
  });

  it("cannot add a client for someone else, or a transaction to another's client", async () => {
    await expectDbError(
      withTestDb(() => withPractice(subScope(), (tx) => tx.insert(investors).values({ practiceId: P, name: "X", assignedUserId: other }))),
      /row-level security/,
    );
    await expectDbError(
      withTestDb(() =>
        withPractice(subScope(), (tx) =>
          tx.insert(transactions).values({ practiceId: P, investorId: theirs, type: "sip", tradeDate: "2026-01-01", amount: "1", source: "manual" }),
        ),
      ),
      /row-level security/,
    );
  });

  it("cannot hand their client to someone else, or touch another's client", async () => {
    await expectDbError(
      withTestDb(() => withPractice(subScope(), (tx) => tx.update(investors).set({ assignedUserId: other }).where(eq(investors.id, mine)))),
      /row-level security/,
    );
    const changed = await withTestDb(() =>
      withPractice(subScope(), (tx) => tx.update(investors).set({ name: "Hacked" }).where(eq(investors.id, theirs)).returning()),
    );
    expect(changed).toHaveLength(0);
  });

  it("refuses a limited scope without a user", async () => {
    await expect(withTestDb(() => withPractice({ practiceId: P, userId: "", limited: true }, async () => 1))).rejects.toThrow(/limited scope/);
  });
});
