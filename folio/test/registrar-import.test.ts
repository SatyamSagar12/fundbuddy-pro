/** Importing registrar transactions into a practice: clients, folios, schemes, duplicates, typed entries. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { folios, instruments, investors, practices, transactions } from "@/server/db/schema";
import { newWrappedDataKey, practiceCrypto, randomBytes, toB64url, type PracticeCrypto } from "@/server/crypto";
import { applyImport, planImport } from "@/server/registrar-import";
import { saveSchemes } from "@/server/nav";
import { parseNavAll } from "@/lib/amfi";
import { readTables } from "@/lib/imports/tables";
import { readFeed } from "@/lib/imports/feed";
import type { Member } from "@/server/member";
import { withTestDb } from "./helpers";

const MASTER = toB64url(randomBytes(32));
const NAVALL = readFileSync(new URL("./fixtures/NAVAll-sample.txt", import.meta.url), "utf8");
const CODES = parseNavAll(NAVALL).map((r) => r.amfiCode);
let P = "";
let pc: PracticeCrypto;
let ramesh = "";
let member: Member;

async function camsTxns() {
  const rows = (await readTables("cams-feed.csv", new Uint8Array(readFileSync(new URL("./fixtures/imports/cams-feed.csv", import.meta.url)))))[0]!.rows;
  return readFeed(rows).txns;
}

beforeAll(() =>
  withTestDb(async () => {
    await db().delete(instruments).where(inArray(instruments.amfiCode, CODES));
    await saveSchemes(parseNavAll(NAVALL));
    P = crypto.randomUUID();
    await db().insert(practices).values({ id: P, name: "Registrar import test", arn: "ARN-12345", billingExempt: true, dataKeyWrapped: await newWrappedDataKey(MASTER, P) });
    const [p] = await db().select().from(practices).where(eq(practices.id, P));
    pc = await practiceCrypto(MASTER, P, p!.dataKeyWrapped);
    member = { userId: crypto.randomUUID(), practiceId: P, role: "owner", name: "Owner", email: "o@example.com" };
    ramesh = crypto.randomUUID();
    await withPractice(P, async (tx) => {
      await tx.insert(investors).values({ id: ramesh, practiceId: P, name: "Ramesh Kumar", taxIdHash: await pc.taxIdHash("ZZRPK1001A"), taxIdLast4: "001A" });
      // Typed by hand earlier: the registrar's purchase (₹15,000 on 1 Apr) replaces it.
      await tx.insert(transactions).values({ practiceId: P, investorId: ramesh, type: "purchase", tradeDate: "2025-04-02", amount: "15000", schemeText: "HDFC Flexi Cap Fund", source: "manual", sourceTxnId: "typed-1" });
      // Different amount: stays.
      await tx.insert(transactions).values({ practiceId: P, investorId: ramesh, type: "purchase", tradeDate: "2025-04-02", amount: "999", schemeText: "HDFC Flexi Cap Fund", source: "manual", sourceTxnId: "typed-2" });
    });
  }),
);

afterAll(() =>
  withTestDb(async () => {
    await db().delete(practices).where(eq(practices.id, P));
    await db().delete(instruments).where(inArray(instruments.amfiCode, CODES));
  }),
);

describe("registrar import", () => {
  it("previews without saving: clients by PAN, a new client, schemes, the typed entry it replaces", async () => {
    const plan = await withTestDb(async () => planImport(member, pc, { source: "cams", fileName: "cams-feed.csv", txns: await camsTxns() }));
    expect(plan).toMatchObject({ total: 5, toAdd: 5, alreadyIn: 0, replacesTyped: 1, newClients: 1, schemesUnmatched: [], heldAway: 0, error: null });
    expect(plan.clients.map((c) => [c.name, c.investorId === ramesh, c.entries])).toEqual([
      ["Ramesh Kumar", true, 4],
      ["SUNITA NEWCLIENT", false, 1],
    ]);
    const [n] = await withTestDb(() => withPractice(P, (tx) => tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.source, "cams"))));
    expect(n).toBeUndefined();
  });

  it("imports: exact units, folios, a new client with an encrypted PAN, the typed duplicate removed", async () => {
    const r = await withTestDb(async () => applyImport(member, pc, { source: "cams", fileName: "cams-feed.csv", txns: await camsTxns() }));
    expect(r.added).toBe(5);
    const rows = await withTestDb(() =>
      withPractice(P, (tx) => tx.select().from(transactions).where(eq(transactions.investorId, ramesh)).orderBy(transactions.tradeDate)),
    );
    expect(rows.map((t) => [t.source, t.type, t.amount, t.units, t.unitsEstimated, !!t.instrumentId, !!t.folioId])).toEqual([
      ["cams", "purchase", "15000.00", "10.0000", false, true, true],
      ["manual", "purchase", "999.00", null, false, false, false],
      ["cams", "sip", "3000.00", "1.9500", false, true, true],
      ["cams", "sip", "-3000.00", "-2.0000", false, true, true],
      ["cams", "redemption", "3500.00", "2.0000", false, true, true],
    ]);
    const [sunita] = await withTestDb(() => withPractice(P, (tx) => tx.select().from(investors).where(eq(investors.name, "Sunita Newclient"))));
    expect(sunita).toBeTruthy();
    expect(await pc.decrypt("tax_id", sunita!.id, sunita!.taxIdEnc!)).toBe("ZZSPN2002B");
    expect(sunita!.taxIdHash).toBe(await pc.taxIdHash("ZZSPN2002B"));
    const f = await withTestDb(() => withPractice(P, (tx) => tx.select().from(folios).orderBy(folios.folioNo)));
    expect(f.map((x) => [x.folioNo, x.amc, x.heldAway])).toEqual([
      ["1234567/89", "HDFC Mutual Fund", false],
      ["7654321", "PPFAS Mutual Fund", false],
    ]);
  });

  it("adds nothing when the same file comes again", async () => {
    const plan = await withTestDb(async () => planImport(member, pc, { source: "cams", fileName: "again.csv", txns: await camsTxns() }));
    expect(plan).toMatchObject({ toAdd: 0, alreadyIn: 5, newClients: 0 });
    const r = await withTestDb(async () => applyImport(member, pc, { source: "cams", fileName: "again.csv", txns: await camsTxns() }));
    expect(r.added).toBe(0);
  });

  it("doesn't count a transaction twice when a CAS repeats a CAMS report", async () => {
    const [first] = await camsTxns();
    const plan = await withTestDb(() => planImport(member, pc, { source: "cas", fileName: "cas.pdf", txns: [{ ...first!, ref: "cas-same" }], investorId: ramesh }));
    expect(plan).toMatchObject({ toAdd: 0, alreadyIn: 1 });
  });

  it("puts a CAS on the chosen client and marks folios through other distributors", async () => {
    const txns = (await camsTxns()).slice(0, 1).map((t) => ({ ...t, ref: "cas-1", folio: "5550001", pan: null, arn: "ARN-99999" }));
    const r = await withTestDb(() => applyImport(member, pc, { source: "cas", fileName: "cas.pdf", txns, investorId: ramesh }));
    expect(r.added).toBe(1);
    expect(r.plan.heldAway).toBe(1);
    const [f] = await withTestDb(() => withPractice(P, (tx) => tx.select().from(folios).where(eq(folios.folioNo, "5550001"))));
    expect(f).toMatchObject({ investorId: ramesh, heldAway: true });
  });

  it("refuses a client from another practice", async () => {
    await expect(withTestDb(async () => planImport(member, pc, { source: "cas", fileName: "x.pdf", txns: await camsTxns(), investorId: crypto.randomUUID() }))).rejects.toThrow(/Client not found/);
  });
});
