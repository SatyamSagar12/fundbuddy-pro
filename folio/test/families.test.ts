/** Families: the summary maths, and the database rules for who sees which family. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { families, investors, practices, users } from "@/server/db/schema";
import { familyProblem, summariseFamilies, type MemberHolding } from "@/lib/families";
import { valueHolding } from "@/lib/holdings";
import { expectDbError, withTestDb } from "./helpers";

const holding = (investorId: string, amount: number, units: number, nav: number): MemberHolding => ({
  ...valueHolding([{ date: "2024-01-01", type: "purchase", amount, units }], nav, "2026-01-01"),
  investorId,
  navDate: "2026-01-01",
});

describe("family summary", () => {
  const fams = [
    { id: "f1", name: "Sharma family", headInvestorId: "b" },
    { id: "f2", name: "Verma family", headInvestorId: null },
  ];
  const members = [
    { id: "a", name: "Asha Sharma", familyId: "f1" },
    { id: "b", name: "Bharat Sharma", familyId: "f1" },
    { id: "c", name: "Chetan Verma", familyId: "f2" },
    { id: "d", name: "Alone", familyId: null },
  ];
  const holdings = [holding("a", 10000, 100, 150), holding("b", 20000, 200, 110), holding("c", 5000, 50, 100), holding("d", 99999, 1, 1)];

  it("adds every member's value, cost and gain, with one XIRR over all their money", () => {
    const [sharma, verma] = summariseFamilies(fams, members, holdings, new Map([["a", 500]]));
    expect(sharma!.name).toBe("Sharma family");
    expect(sharma!.total.value).toBe(15000 + 22000);
    expect(sharma!.total.cost).toBe(30000);
    expect(sharma!.total.gain).toBe(7000);
    // Unmatched money counts as invested, not as value.
    expect(sharma!.invested).toBe(30500);
    expect(sharma!.total.xirr).toBeGreaterThan(0.1);
    expect(sharma!.shown.label).toBe("XIRR");
    expect(verma!.total.value).toBe(5000);
    expect(verma!.head).toBeNull();
  });

  it("lists the head first and leaves out clients of other families", () => {
    const [sharma] = summariseFamilies(fams, members, holdings);
    expect(sharma!.head).toEqual({ id: "b", name: "Bharat Sharma" });
    expect(sharma!.members.map((m) => m.id)).toEqual(["b", "a"]);
    expect(sharma!.members[0]!.isHead).toBe(true);
  });

  it("a family with nothing invested yet shows zeros, not errors", () => {
    const [empty] = summariseFamilies([{ id: "e", name: "New family", headInvestorId: null }], [{ id: "x", name: "X", familyId: "e" }], []);
    expect(empty!.total.value).toBe(0);
    expect(empty!.shown.value).toBeNull();
  });

  it("checks the head is a member", () => {
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    expect(familyProblem({ name: "X family", memberIds: [a], headId: b })).toMatch(/head/);
    expect(familyProblem({ name: "X family", memberIds: [a, a], headId: a })).toMatch(/twice/);
    expect(familyProblem({ name: "X family", memberIds: [a, b], headId: a })).toBeNull();
  });
});

let P = "";
let P2 = "";
let sub = "";
let other = "";
let mine = "";
let theirs = "";
let shared = "";
let othersOnly = "";
let foreign = "";

beforeAll(() =>
  withTestDb(async () => {
    const [p, p2] = await db()
      .insert(practices)
      .values([
        { name: "Families test", dataKeyWrapped: "x" },
        { name: "Families other practice", dataKeyWrapped: "x" },
      ])
      .returning();
    P = p!.id;
    P2 = p2!.id;
    const u = await db()
      .insert(users)
      .values([
        { email: `fam-sub-${P}@example.com`, name: "Sub", passwordHash: "x" },
        { email: `fam-other-${P}@example.com`, name: "Other", passwordHash: "x" },
      ])
      .returning();
    sub = u[0]!.id;
    other = u[1]!.id;
    await withPractice(P, async (tx) => {
      const f = await tx
        .insert(families)
        .values([
          { practiceId: P, name: "Shared" },
          { practiceId: P, name: "Others only" },
        ])
        .returning();
      shared = f[0]!.id;
      othersOnly = f[1]!.id;
      const rows = await tx
        .insert(investors)
        .values([
          { practiceId: P, name: "Mine", assignedUserId: sub, familyId: shared },
          { practiceId: P, name: "Theirs", assignedUserId: other, familyId: shared },
          { practiceId: P, name: "Theirs too", assignedUserId: other, familyId: othersOnly },
        ])
        .returning();
      mine = rows[0]!.id;
      theirs = rows[1]!.id;
    });
    await withPractice(P2, async (tx) => {
      const [f] = await tx.insert(families).values({ practiceId: P2, name: "Foreign" }).returning();
      foreign = f!.id;
    });
  }),
);

afterAll(() =>
  withTestDb(async () => {
    await db().delete(practices).where(inArray(practices.id, [P, P2]));
    await db().delete(users).where(inArray(users.id, [sub, other]));
  }),
);

const subScope = () => ({ practiceId: P, userId: sub, limited: true });

describe("families and sub-brokers (row-level security)", () => {
  it("a sub-broker sees only families holding one of their clients, and only their own clients in it", async () => {
    const seen = await withTestDb(() =>
      withPractice(subScope(), async (tx) => ({
        families: (await tx.select().from(families)).map((f) => f.name),
        members: (await tx.select().from(investors).where(eq(investors.familyId, shared))).map((r) => r.name),
      })),
    );
    expect(seen).toEqual({ families: ["Shared"], members: ["Mine"] });
  });

  it("owners and staff see every family of their practice, never another practice's", async () => {
    const names = await withTestDb(() => withPractice(P, async (tx) => (await tx.select().from(families)).map((f) => f.name).sort()));
    expect(names).toEqual(["Others only", "Shared"]);
  });

  it("a sub-broker can't rename or delete a family without their clients, nor delete a shared one", async () => {
    const result = await withTestDb(() =>
      withPractice(subScope(), async (tx) => ({
        renamed: await tx.update(families).set({ name: "Hacked" }).where(eq(families.id, othersOnly)).returning(),
        deleted: await tx.delete(families).where(eq(families.id, shared)).returning(),
      })),
    );
    expect(result).toEqual({ renamed: [], deleted: [] });
    const names = await withTestDb(() => withPractice(P, async (tx) => (await tx.select().from(families)).map((f) => f.name).sort()));
    expect(names).toEqual(["Others only", "Shared"]);
  });

  it("a sub-broker can start a family and put their own client in it, but not someone else's", async () => {
    const id = crypto.randomUUID();
    const moved = await withTestDb(() =>
      withPractice(subScope(), async (tx) => {
        await tx.insert(families).values({ id, practiceId: P, name: "New one" });
        const own = await tx.update(investors).set({ familyId: id }).where(eq(investors.id, mine)).returning();
        const others = await tx.update(investors).set({ familyId: id }).where(eq(investors.id, theirs)).returning();
        return { own: own.length, others: others.length, visible: (await tx.select().from(families).where(eq(families.id, id))).length };
      }),
    );
    expect(moved).toEqual({ own: 1, others: 0, visible: 1 });
    await withTestDb(() => withPractice(P, (tx) => tx.update(investors).set({ familyId: shared }).where(eq(investors.id, mine))));
  });

  it("nobody can create a family in another practice", async () => {
    await expectDbError(
      withTestDb(() => withPractice(P, (tx) => tx.insert(families).values({ practiceId: P2, name: "Sneaky" }))),
      /row-level security/,
    );
    const seen = await withTestDb(() => withPractice(P, async (tx) => (await tx.select().from(families).where(eq(families.id, foreign))).length));
    expect(seen).toBe(0);
  });
});
