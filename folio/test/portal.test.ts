/**
 * Client portal: a signed-in client sees only their own and their family's data, can change nothing, and can't read
 * encrypted details or account tables, enforced by the database (role folio_portal, migration 0011). Plus who an
 * email may see, the sign-in codes and the rate limits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withInvestors, withPractice, type InvestorScope } from "@/server/db/scope";
import { families, folios, investors, portalCodes, practices, sessions, sips, transactions, users } from "@/server/db/schema";
import { checkPortalCode, issuePortalCode, mayAskForCode, mayEnterCode, newPortalCode, peopleForEmail } from "@/server/portal";
import { expectDbError, withTestDb } from "./helpers";

process.env["SESSION_SECRET"] ||= "dGVzdC1zZXNzaW9uLXNlY3JldC10ZXN0LXNlc3Npb24tc2VjcmV0";
process.env["MASTER_KEY"] ||= "dGVzdC1tYXN0ZXIta2V5LXRlc3QtbWFzdGVyLWtleS10ZXN0LW1h";

const RUN = Date.now();
const mail = (who: string) => `${who}.${RUN}@example.com`;
let P = "";
let P2 = "";
const id: Record<string, string> = {};

beforeAll(() =>
  withTestDb(async () => {
    const [p, p2] = await db()
      .insert(practices)
      .values([
        { name: "Portal test", dataKeyWrapped: "x", portalEnabled: true },
        { name: "Portal other practice", dataKeyWrapped: "x", portalEnabled: true },
      ])
      .returning();
    P = p!.id;
    P2 = p2!.id;
    await withPractice(P, async (tx) => {
      const f = await tx
        .insert(families)
        .values([
          { practiceId: P, name: "Asha's family" },
          { practiceId: P, name: "Gita's family" },
        ])
        .returning();
      id["F"] = f[0]!.id;
      id["G"] = f[1]!.id;
      const rows = await tx
        .insert(investors)
        .values([
          { practiceId: P, name: "Asha", email: mail("asha"), familyId: id["F"], taxIdEnc: "secret", notes: "private note" },
          { practiceId: P, name: "Bharat", email: null, familyId: id["F"] },
          { practiceId: P, name: "Chetan", email: mail("chetan") },
          { practiceId: P, name: "Dev", email: mail("shared"), familyId: id["F"] },
          { practiceId: P, name: "Esha", email: mail("SHARED").toUpperCase(), familyId: id["G"] },
          { practiceId: P, name: "Gita", email: mail("gita"), familyId: id["G"] },
        ])
        .returning();
      for (const r of rows) id[r.name] = r.id;
      for (const r of rows) {
        const [fo] = await tx.insert(folios).values({ practiceId: P, investorId: r.id, amc: "HDFC", folioNo: `F-${r.name}` }).returning();
        await tx.insert(transactions).values({ practiceId: P, investorId: r.id, folioId: fo!.id, type: "purchase", tradeDate: "2025-01-01", amount: "1000", source: "manual" });
        await tx.insert(sips).values({ practiceId: P, investorId: r.id, amount: "500", frequency: "monthly", startDate: "2025-01-01", status: "active", source: "manual" });
      }
    });
    await withPractice(P2, async (tx) => {
      const [z] = await tx.insert(investors).values({ practiceId: P2, name: "Zara", email: mail("asha") }).returning();
      id["Zara"] = z!.id;
      await tx.insert(transactions).values({ practiceId: P2, investorId: z!.id, type: "purchase", tradeDate: "2025-01-01", amount: "9999", source: "manual" });
    });
  }),
);

afterAll(() => withTestDb(async () => void (await db().delete(practices).where(inArray(practices.id, [P, P2])))));

/** What a portal scope can see, by table. */
const seen = (scope: InvestorScope) =>
  withTestDb(() =>
    withInvestors(scope, async (tx) => ({
      investors: (await tx.select({ id: investors.id, name: investors.name }).from(investors)).map((r) => r.name).sort(),
      families: (await tx.select({ name: families.name }).from(families)).map((r) => r.name).sort(),
      folios: (await tx.select({ investorId: folios.investorId }).from(folios)).length,
      transactions: (await tx.select({ investorId: transactions.investorId }).from(transactions)).map((r) => r.investorId).sort(),
      sips: (await tx.select({ investorId: sips.investorId }).from(sips)).length,
    })),
  );

describe("who an email may see", () => {
  it("the client with that email and everyone in their family", async () => {
    const who = await withTestDb(() => peopleForEmail(P, mail("asha")));
    expect(who.ok && who.people.map((p) => p.name)).toEqual(["Asha", "Bharat", "Dev"]);
    expect(who.ok && who.familyName).toBe("Asha's family");
  });
  it("ignores upper and lower case", async () => {
    const who = await withTestDb(() => peopleForEmail(P, mail("ASHA").toUpperCase()));
    expect(who.ok).toBe(true);
  });
  it("a client without a family sees only themselves", async () => {
    const who = await withTestDb(() => peopleForEmail(P, mail("chetan")));
    expect(who.ok && who.investorIds).toEqual([id["Chetan"]]);
    expect(who.ok && who.familyName).toBeNull();
  });
  it("an email on clients of two families can't sign in at all", async () => {
    expect(await withTestDb(() => peopleForEmail(P, mail("shared")))).toEqual({ ok: false, reason: "shared" });
  });
  it("an unknown email, or one from another practice, finds nothing here", async () => {
    expect(await withTestDb(() => peopleForEmail(P, mail("nobody")))).toEqual({ ok: false, reason: "none" });
    const other = await withTestDb(() => peopleForEmail(P2, mail("asha")));
    expect(other.ok && other.investorIds).toEqual([id["Zara"]]);
  });
});

describe("the portal's database scope (row-level security)", () => {
  it("sees only its own clients' investors, families, folios, transactions and SIPs", async () => {
    const s = await seen({ practiceId: P, investorIds: [id["Asha"]!, id["Bharat"]!] });
    expect(s).toEqual({ investors: ["Asha", "Bharat"], families: ["Asha's family"], folios: 2, transactions: [id["Asha"], id["Bharat"]].sort(), sips: 2 });
  });

  it("a client without a family sees no family and nobody else", async () => {
    expect(await seen({ practiceId: P, investorIds: [id["Chetan"]!] })).toEqual({ investors: ["Chetan"], families: [], folios: 1, transactions: [id["Chetan"]], sips: 1 });
  });

  it("another practice's client id gets nothing, whichever practice is named", async () => {
    const empty = { investors: [], families: [], folios: 0, transactions: [], sips: 0 };
    expect(await seen({ practiceId: P, investorIds: [id["Zara"]!] })).toEqual(empty);
    expect(await seen({ practiceId: P2, investorIds: [id["Asha"]!] })).toEqual(empty);
  });

  it("can't change anything", async () => {
    const scope = { practiceId: P, investorIds: [id["Asha"]!] };
    await expectDbError(
      withTestDb(() => withInvestors(scope, (tx) => tx.insert(transactions).values({ practiceId: P, investorId: id["Asha"]!, type: "purchase", tradeDate: "2025-01-02", amount: "1", source: "manual" }))),
      /permission denied/,
    );
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.update(transactions).set({ amount: "0" }))), /permission denied/);
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.delete(sips))), /permission denied/);
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.update(investors).set({ name: "X" }))), /permission denied/);
  });

  it("can't read encrypted PAN, bank or nominee details, or the distributor's notes", async () => {
    const scope = { practiceId: P, investorIds: [id["Asha"]!] };
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.select({ pan: investors.taxIdEnc }).from(investors))), /permission denied/);
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.select({ n: investors.notes }).from(investors))), /permission denied/);
    await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.select().from(investors))), /permission denied/);
  });

  it("can't read account tables: practices, users, team sessions, sign-in codes", async () => {
    const scope = { practiceId: P, investorIds: [id["Asha"]!] };
    for (const t of [practices, users, sessions, portalCodes] as const) {
      await expectDbError(withTestDb(() => withInvestors(scope, (tx) => tx.select({ n: sql`1` }).from(t))), /permission denied/);
    }
  });

  it("refuses an empty or malformed scope before touching the database", async () => {
    await expect(withTestDb(() => withInvestors({ practiceId: P, investorIds: [] }, async () => 1))).rejects.toThrow(/Invalid scope/);
    await expect(withTestDb(() => withInvestors({ practiceId: P, investorIds: [`${id["Asha"]}},${id["Gita"]}`] }, async () => 1))).rejects.toThrow(/Invalid scope/);
    await expect(withTestDb(() => withInvestors({ practiceId: "nope", investorIds: [id["Asha"]!] }, async () => 1))).rejects.toThrow(/Invalid scope/);
  });

  it("the team's scope is unchanged: a member still sees everyone in their practice", async () => {
    const n = await withTestDb(() => withPractice(P, async (tx) => (await tx.select({ id: investors.id }).from(investors)).length));
    expect(n).toBe(6);
  });
});

describe("sign-in codes", () => {
  it("are six digits", () => {
    for (let i = 0; i < 50; i++) expect(newPortalCode()).toMatch(/^\d{6}$/);
  });

  it("work once", async () => {
    const e = mail("chetan");
    const code = await withTestDb(() => issuePortalCode(P, e));
    expect(await withTestDb(() => checkPortalCode(P, e, code))).toBe("ok");
    expect(await withTestDb(() => checkPortalCode(P, e, code))).toBe("used_up");
  });

  it("allow 5 wrong tries, then not even the right code works", async () => {
    const e = mail("gita");
    const code = await withTestDb(() => issuePortalCode(P, e));
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await withTestDb(() => checkPortalCode(P, e, wrong)));
    expect(results).toEqual(["wrong", "wrong", "wrong", "wrong", "used_up"]);
    expect(await withTestDb(() => checkPortalCode(P, e, code))).toBe("used_up");
  });

  it("expire after 10 minutes", async () => {
    const e = mail("asha");
    const code = await withTestDb(() => issuePortalCode(P, e));
    await withTestDb(() => db().update(portalCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(portalCodes.practiceId, P)));
    expect(await withTestDb(() => checkPortalCode(P, e, code))).toBe("used_up");
  });

  it("a new code replaces the old one", async () => {
    const e = mail("asha");
    const first = await withTestDb(() => issuePortalCode(P, e));
    const second = await withTestDb(() => issuePortalCode(P, e));
    if (first !== second) expect(await withTestDb(() => checkPortalCode(P, e, first))).toBe("wrong");
    expect(await withTestDb(() => checkPortalCode(P, e, second))).toBe("ok");
  });

  it("only work for the practice and email they were made for", async () => {
    const code = await withTestDb(() => issuePortalCode(P, mail("asha")));
    expect(await withTestDb(() => checkPortalCode(P2, mail("asha"), code))).toBe("used_up");
    expect(await withTestDb(() => checkPortalCode(P, mail("chetan"), code))).toBe("used_up");
    expect(await withTestDb(() => checkPortalCode(P, mail("asha"), code))).toBe("ok");
  });

  it("are stored only as a keyed hash", async () => {
    const code = await withTestDb(() => issuePortalCode(P, mail("gita")));
    const rows = await withTestDb(() => db().select().from(portalCodes).where(eq(portalCodes.practiceId, P)));
    expect(rows.some((r) => r.codeHash.includes(code))).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash))).toBe(true);
  });
});

describe("rate limits", () => {
  it("3 codes per email every 15 minutes, other emails unaffected", async () => {
    const ip = `test-ask-${RUN}`;
    const asks = [];
    for (let i = 0; i < 4; i++) asks.push(await withTestDb(() => mayAskForCode(P, mail("limit"), ip)));
    expect(asks).toEqual([true, true, true, false]);
    expect(await withTestDb(() => mayAskForCode(P, mail("limit2"), ip))).toBe(true);
  });

  it("10 codes per network every 15 minutes, whatever the emails", async () => {
    const ip = `test-ip-${RUN}`;
    const asks = [];
    for (let i = 0; i < 11; i++) asks.push(await withTestDb(() => mayAskForCode(P, mail(`many${i}`), ip)));
    expect(asks.filter(Boolean)).toHaveLength(10);
    expect(asks.at(-1)).toBe(false);
  });

  it("10 code entries per email every 15 minutes", async () => {
    const tries = [];
    for (let i = 0; i < 11; i++) tries.push(await withTestDb(() => mayEnterCode(P, mail("guess"), `test-enter-${RUN}-${i}`)));
    expect(tries.slice(0, 10).every(Boolean)).toBe(true);
    expect(tries[10]).toBe(false);
  });
});
