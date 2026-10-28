/** SIP book from imported registrar data, and the morning briefing built from it. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { investors, practices, sips } from "@/server/db/schema";
import { newWrappedDataKey, practiceCrypto, randomBytes, toB64url } from "@/server/crypto";
import { applyImport } from "@/server/registrar-import";
import { loadSipBook } from "@/server/sip-book";
import { buildBriefing } from "@/server/briefing";
import { briefingText } from "@/lib/briefing-text";
import { readTables } from "@/lib/imports/tables";
import { readFeed } from "@/lib/imports/feed";
import type { Member } from "@/server/member";
import { withTestDb } from "./helpers";

const MASTER = toB64url(randomBytes(32));
let P = "";
let typedSip = "";

beforeAll(() =>
  withTestDb(async () => {
    P = crypto.randomUUID();
    await db().insert(practices).values({ id: P, name: "Briefing test", arn: "ARN-12345", billingExempt: true, dataKeyWrapped: await newWrappedDataKey(MASTER, P) });
    const [p] = await db().select().from(practices).where(eq(practices.id, P));
    const pc = await practiceCrypto(MASTER, P, p!.dataKeyWrapped);
    const member: Member = { userId: crypto.randomUUID(), practiceId: P, role: "owner", name: "Owner", email: "o@example.com" };
    const rows = (await readTables("cams-feed.csv", new Uint8Array(readFileSync(new URL("./fixtures/imports/cams-feed.csv", import.meta.url)))))[0]!.rows;
    await applyImport(member, pc, { source: "cams", fileName: "cams-feed.csv", txns: readFeed(rows).txns });
    await withPractice(P, async (tx) => {
      const [ramesh] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.name, "Ramesh Kumar"));
      await tx.update(investors).set({ mobile: "98765 43210", dob: "1970-06-12" }).where(eq(investors.id, ramesh!.id));
      // Typed in the old app: the same SIP as the registrar's, and one the registrar doesn't know.
      const [a] = await tx
        .insert(sips)
        .values({ practiceId: P, investorId: ramesh!.id, schemeText: "HDFC Flexi Cap Fund Growth", amount: "3000", frequency: "monthly", startDate: "2025-05-05", status: "active", source: "legacy" })
        .returning({ id: sips.id });
      typedSip = a!.id;
      await tx.insert(sips).values({ practiceId: P, investorId: ramesh!.id, schemeText: "Some Other Fund", amount: "1000", frequency: "monthly", startDate: "2025-01-10", endDate: "2025-07-10", status: "active", source: "legacy" });
    });
  }),
);

afterAll(() => withTestDb(() => db().delete(practices).where(eq(practices.id, P))));

describe("SIP book and briefing", () => {
  it("finds the SIP in registrar data, sees the bounce, and merges the typed copy", async () => {
    const { rows } = await withTestDb(() => withPractice(P, (tx) => loadSipBook(tx, "2025-06-10")));
    const hdfc = rows.find((r) => r.scheme.includes("HDFC"))!;
    expect(hdfc).toMatchObject({ id: typedSip, typedId: typedSip, auto: true, status: "bounced", amount: 3000, folioNo: "1234567/89", lastBounce: "2025-05-05" });
    const other = rows.find((r) => r.scheme === "Some Other Fund")!;
    expect(other).toMatchObject({ auto: false, status: "active", endingSoon: true, nextDue: "2025-06-10" });
    // Plus the new client's own SIP in the same file.
    expect(rows.map((r) => r.client).sort()).toEqual(["Ramesh Kumar", "Ramesh Kumar", "Sunita Newclient"]);
  });

  it("puts the bounce and the birthday in the morning briefing", async () => {
    const b = await withTestDb(() => withPractice(P, (tx) => buildBriefing(tx, "2025-06-10")));
    expect(b.sips.bouncedList).toEqual([expect.objectContaining({ client: "Ramesh Kumar", amount: 3000, mobile: "98765 43210" })]);
    expect(b.birthdays).toEqual([expect.objectContaining({ client: "Ramesh Kumar", inDays: 2 })]);
    const mail = briefingText(b, { name: "Nawal Kishore", appUrl: "https://folio.example" });
    expect(mail.subject).toMatch(/1 SIP bounced/);
    expect(mail.text).toMatch(/Good morning, Nawal\./);
    expect(mail.text).toMatch(/SIP bounced: Ramesh Kumar, ₹3,000 in HDFC Flexi Cap/);
    expect(mail.text).toMatch(/Birthdays this week: Ramesh Kumar \(Thu\)/);
    expect(mail.text).toMatch(/https:\/\/folio\.example\/app/);
  });
});
