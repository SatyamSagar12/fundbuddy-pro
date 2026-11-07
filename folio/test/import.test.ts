import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { investors, practices, sips, transactions } from "@/server/db/schema";
import { newWrappedDataKey, practiceCrypto, randomBytes, toB64url, type PracticeCrypto } from "@/server/crypto";
import { importFundVault, parseCsv } from "@/server/import-fundvault";
import { withTestDb } from "./helpers";

const MASTER = toB64url(randomBytes(32));
let practiceId = "";
let pc: PracticeCrypto;

const clientsCsv = `id,name,mobile,email,address,pan,nominee_name,nominee_dob,created_at,dob,bank_account_no,bank_name,ifsc_code,micr_code,branch_name,nominee_pan,nominee_mobile,nominee_email,nominee_relation
11111111-1111-1111-1111-111111111111,Rahul Sharma,9876543210,rahul.sharma@example.com,"12 MG Road, Pune",ABCDE1234F,Anita Sharma,1985-04-12,2026-08-16,,,,,,,,,,
aaaaaaaa-0000-0000-0000-000000000001,Ramesh Kumar,9812300001,ramesh@example.com,"House 4, ""Shanti"" Nagar
Patna",abcpk1234q,Sita Devi,1960-02-01,2026-08-20,1958-07-15,123456789012,State Bank of India,SBIN0001234,800002001,Patna Main,,9812300002,,Spouse
aaaaaaaa-0000-0000-0000-000000000002,Meena Kumari,9812300003,,,,,,2026-08-21,,,,,,,,,,`;
const investmentsCsv = `id,client_id,scheme,type,amount,date,payment_mode,transaction_id,created_at
bbbbbbbb-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000001,HDFC Flexi Cap Fund,One-time,150000,2026-01-15,Online,TXN1,2026-08-20
bbbbbbbb-0000-0000-0000-000000000002,aaaaaaaa-0000-0000-0000-000000000001,ICICI Bluechip Fund,SIP,5000.50,2026-02-05,Cheque,,2026-08-20
bbbbbbbb-0000-0000-0000-000000000003,11111111-1111-1111-1111-111111111111,Sample Fund,One-time,99,2026-02-05,Online,,2026-08-20`;
const sipsCsv = `id,client_id,scheme,amount,frequency,start_date,status,created_at
cccccccc-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000001,ICICI Bluechip Fund,5000,Monthly,2026-02-05,Active,2026-08-20
cccccccc-0000-0000-0000-000000000002,aaaaaaaa-0000-0000-0000-000000000002,Axis Midcap Fund,3000,Quarterly,2026-03-01,Paused,2026-08-20`;

const data = () => ({ clients: parseCsv(clientsCsv), investments: parseCsv(investmentsCsv), sips: parseCsv(sipsCsv) });

beforeAll(() =>
  withTestDb(async () => {
    practiceId = crypto.randomUUID();
    await db().insert(practices).values({ id: practiceId, name: "Import test", dataKeyWrapped: await newWrappedDataKey(MASTER, practiceId) });
    const [p] = await db().select().from(practices).where(eq(practices.id, practiceId));
    pc = await practiceCrypto(MASTER, practiceId, p!.dataKeyWrapped);
  }),
);
afterAll(() => withTestDb(async () => void (await db().delete(practices).where(eq(practices.id, practiceId)))));

describe("FundVault import", () => {
  it("parses quoted CSV with commas, quotes and line breaks", () => {
    const c = parseCsv(clientsCsv);
    expect(c).toHaveLength(3);
    expect(c[1]!["address"]).toBe('House 4, "Shanti" Nagar\nPatna');
  });

  it("dry run reports but saves nothing", async () => {
    const report = await withTestDb(() => importFundVault(practiceId, pc, data(), { dryRun: true }));
    expect(report.clients.imported).toBe(2);
    const [n] = await withTestDb(() => withPractice(practiceId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(investors)));
    expect(n!.n).toBe(0);
  });

  it("imports clients encrypted, skips samples, and totals match", async () => {
    const report = await withTestDb(() => importFundVault(practiceId, pc, data()));
    expect(report.clients).toEqual({ imported: 2, skippedSamples: 1 });
    expect(report.investments.imported).toBe(2);
    expect(report.totals.oldInvested).toBeCloseTo(155000.5);
    expect(report.totals.newInvested).toBeCloseTo(155000.5);
    expect(report.totals.newActiveSips).toBe(1);

    const rows = await withTestDb(() => withPractice(practiceId, (tx) => tx.select().from(investors)));
    const ramesh = rows.find((r) => r.name === "Ramesh Kumar")!;
    expect(ramesh.taxIdLast4).toBe("234Q");
    expect(ramesh.taxIdEnc).not.toContain("ABCPK");
    expect(await pc.decrypt("tax_id", ramesh.id, ramesh.taxIdEnc!)).toBe("ABCPK1234Q");
    expect(ramesh.taxIdHash).toBe(await pc.taxIdHash("ABCPK1234Q"));
    expect(JSON.parse(await pc.decrypt("bank", ramesh.id, ramesh.bankEnc!))).toMatchObject({ ifsc: "SBIN0001234", accountNo: "123456789012" });
    expect(JSON.parse(await pc.decrypt("nominee", ramesh.id, ramesh.nomineeEnc!))).toMatchObject({ name: "Sita Devi", relation: "Spouse" });
    const meena = rows.find((r) => r.name === "Meena Kumari")!;
    expect(meena.bankEnc).toBeNull();
    expect(meena.taxIdEnc).toBeNull();
  });

  it("can run again without duplicating anything", async () => {
    await withTestDb(() => importFundVault(practiceId, pc, data()));
    const counts = await withTestDb(() =>
      withPractice(practiceId, async (tx) => ({
        investors: (await tx.select().from(investors)).length,
        transactions: (await tx.select().from(transactions)).length,
        sips: (await tx.select().from(sips)).length,
      })),
    );
    expect(counts).toEqual({ investors: 2, transactions: 2, sips: 2 });
  });
});
