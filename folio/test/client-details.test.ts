/** Client details (mobile, email, address, birthday) from registrar reports. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { folios, investors, practices } from "@/server/db/schema";
import { newWrappedDataKey, practiceCrypto, randomBytes, toB64url, type PracticeCrypto } from "@/server/crypto";
import { applyClientDetails } from "@/server/client-details";
import { cleanEmail, cleanMobile, readContacts } from "@/lib/imports/contacts";
import { readDelimited } from "@/lib/imports/tables";
import type { Member } from "@/server/member";
import { withTestDb } from "./helpers";

describe("reading client details", () => {
  it("cleans mobiles and emails the way registrars write them", () => {
    expect(cleanMobile("+91 98290 12345")).toBe("9829012345");
    expect(cleanMobile("919829012345")).toBe("9829012345");
    expect(cleanMobile("09829012345")).toBe("9829012345");
    expect(cleanMobile("0141-2345678")).toBeNull();
    expect(cleanMobile("")).toBeNull();
    expect(cleanEmail(" Asha.Verma@GMAIL.com ")).toBe("asha.verma@gmail.com");
    expect(cleanEmail("not an email")).toBeNull();
  });

  it("reads an investor master report, and ignores a plain transaction report", () => {
    const master = readDelimited(
      [
        "FOLIO_NO,INV_NAME,PAN,AMC_NAME,EMAIL,MOBILE_NO,ADDRESS1,ADDRESS2,CITY,PINCODE,DOB",
        "1234567/89,RAMESH KUMAR,ZZRPK1001A,HDFC Mutual Fund,ramesh@example.com,+91 98290 11111,12 MG Road,Civil Lines,Jaipur,302001,15/08/1970",
        "7777777/01,SUNITA DEVI,ZZSPD2002B,ICICI Prudential Mutual Fund,,9829022222,,,,,",
        "8888888/01,NO DETAILS,ZZNDD3003C,SBI Mutual Fund,,,,,,,",
      ].join("\n"),
    );
    const rows = readContacts(master);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pan: "ZZRPK1001A", folio: "1234567/89", email: "ramesh@example.com", mobile: "9829011111", address: "12 MG Road, Civil Lines, Jaipur, 302001", dob: "1970-08-15" });
    expect(rows[1]).toMatchObject({ name: "SUNITA DEVI", mobile: "9829022222", email: null });
    expect(readContacts(readDelimited("FOLIO_NO,SCHEME,AMOUNT\n1/2,X Fund,100"))).toEqual([]);
  });
});

const MASTER = toB64url(randomBytes(32));
let P = "";
let pc: PracticeCrypto;
let member: Member;
let ramesh = "";

beforeAll(() =>
  withTestDb(async () => {
    P = crypto.randomUUID();
    await db().insert(practices).values({ id: P, name: "Details test", billingExempt: true, dataKeyWrapped: await newWrappedDataKey(MASTER, P) });
    const [p] = await db().select().from(practices).where(eq(practices.id, P));
    pc = await practiceCrypto(MASTER, P, p!.dataKeyWrapped);
    member = { userId: crypto.randomUUID(), practiceId: P, role: "owner", name: "Owner", email: "o@example.com" };
    ramesh = crypto.randomUUID();
    await withPractice(P, (tx) =>
      tx.insert(investors).values({ id: ramesh, practiceId: P, name: "Ramesh Kumar", mobile: "9000000000", taxIdHash: "", taxIdLast4: "001A" }),
    );
    await withPractice(P, async (tx) => tx.update(investors).set({ taxIdHash: await pc.taxIdHash("ZZRPK1001A") }).where(eq(investors.id, ramesh)));
  }),
);
afterAll(() => withTestDb(() => db().delete(practices).where(eq(practices.id, P))));

describe("saving client details", () => {
  it("fills only empty fields, adds new clients with their folio, and is safe to repeat", async () => {
    const rows = [
      { folio: "1234567/89", pan: "ZZRPK1001A", name: "RAMESH KUMAR", amc: "HDFC Mutual Fund", email: "ramesh@example.com", mobile: "9829011111", address: "Jaipur", dob: "1970-08-15" },
      { folio: "7777777/01", pan: "ZZSPD2002B", name: "SUNITA DEVI", amc: "ICICI Prudential Mutual Fund", email: null, mobile: "9829022222", address: null, dob: null },
      { folio: "9999999/01", pan: null, name: "NO PAN PERSON", amc: "SBI Mutual Fund", email: "x@example.com", mobile: null, address: null, dob: null },
    ];
    const first = await withTestDb(() => applyClientDetails(member, pc, rows, "test"));
    expect(first).toEqual({ updated: 1, created: 1, skippedOverLimit: 0 });
    const people = await withTestDb(() => withPractice(P, (tx) => tx.select().from(investors).orderBy(investors.name)));
    const r = people.find((x) => x.id === ramesh)!;
    // The typed mobile stays; the empty email, address and birthday are filled.
    expect(r).toMatchObject({ mobile: "9000000000", email: "ramesh@example.com", address: "Jaipur", dob: "1970-08-15" });
    const sunita = people.find((x) => x.name === "Sunita Devi")!;
    expect(sunita).toMatchObject({ mobile: "9829022222", taxIdLast4: "002B" });
    expect(await pc.decrypt("tax_id", sunita.id, sunita.taxIdEnc!)).toBe("ZZSPD2002B");
    expect(people.some((x) => x.name.includes("No Pan"))).toBe(false);
    const f = await withTestDb(() => withPractice(P, (tx) => tx.select().from(folios).where(eq(folios.investorId, sunita.id))));
    expect(f.map((x) => x.folioNo)).toEqual(["7777777/01"]);

    const again = await withTestDb(() => applyClientDetails(member, pc, rows, "test"));
    expect(again).toEqual({ updated: 0, created: 0, skippedOverLimit: 0 });
  });
});
