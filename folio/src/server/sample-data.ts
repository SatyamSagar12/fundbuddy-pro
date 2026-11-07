/**
 * Sample data, so a new practice can try every screen before entering real clients.
 * Every sample row is tagged (investors.legacy_id "sample:…", transactions/SIPs source "sample") so
 * "Remove sample data" deletes exactly these and never a real client. Names, PANs and accounts are made up;
 * the PANs use a "ZZ" prefix that real PANs don't.
 */
import { and, eq, like } from "drizzle-orm";
import { withPractice, type Scope } from "./db/scope";
import { investors, sips, transactions } from "./db/schema";
import type { PracticeCrypto } from "./crypto";

type Sample = {
  name: string;
  mobile: string;
  email: string;
  pan: string;
  city: string;
  nominee: [string, string];
  sips: [string, number][];
  lumpsums: [string, number, number][]; // scheme, amount, months ago
};

const SAMPLES: Sample[] = [
  { name: "Ramesh Kumar", mobile: "9800000101", email: "ramesh.sample@example.com", pan: "ZZRPK1001A", city: "Patna", nominee: ["Sita Devi", "Spouse"], sips: [["HDFC Flexi Cap Fund", 5000], ["Parag Parikh Flexi Cap Fund", 3000]], lumpsums: [["SBI Equity Hybrid Fund", 200000, 14]] },
  { name: "Sunita Sharma", mobile: "9800000102", email: "sunita.sample@example.com", pan: "ZZSPS1002B", city: "Jaipur", nominee: ["Arjun Sharma", "Son"], sips: [["ICICI Prudential Bluechip Fund", 10000]], lumpsums: [["Kotak Corporate Bond Fund", 500000, 9]] },
  { name: "Mohammed Irfan", mobile: "9800000103", email: "irfan.sample@example.com", pan: "ZZMPI1003C", city: "Hyderabad", nominee: ["Ayesha Irfan", "Spouse"], sips: [["Axis Midcap Fund", 7500], ["Nippon India Small Cap Fund", 2500]], lumpsums: [] },
  { name: "Priya Menon", mobile: "9800000104", email: "priya.sample@example.com", pan: "ZZPPM1004D", city: "Kochi", nominee: ["Arjun Menon", "Brother"], sips: [["Mirae Asset Large Cap Fund", 4000]], lumpsums: [["HDFC Balanced Advantage Fund", 150000, 5]] },
  { name: "Gurpreet Singh", mobile: "9800000105", email: "gurpreet.sample@example.com", pan: "ZZGPS1005E", city: "Ludhiana", nominee: ["Harleen Kaur", "Daughter"], sips: [["UTI Nifty 50 Index Fund", 6000]], lumpsums: [["ICICI Prudential Equity & Debt Fund", 300000, 16]] },
  { name: "Anita Desai", mobile: "9800000106", email: "anita.sample@example.com", pan: "ZZAPD1006F", city: "Pune", nominee: ["Rohan Desai", "Son"], sips: [], lumpsums: [["SBI Small Cap Fund", 80000, 11], ["Aditya Birla Sun Life Liquid Fund", 250000, 2]] },
  { name: "Vikram Rao", mobile: "9800000107", email: "vikram.sample@example.com", pan: "ZZVPR1007G", city: "Bengaluru", nominee: ["Lakshmi Rao", "Mother"], sips: [["Kotak Emerging Equity Fund", 10000], ["Quant Active Fund", 5000]], lumpsums: [["Canara Robeco Bluechip Equity Fund", 100000, 7]] },
  { name: "Fatima Sheikh", mobile: "9800000108", email: "fatima.sample@example.com", pan: "ZZFPS1008H", city: "Lucknow", nominee: ["Zoya Sheikh", "Daughter"], sips: [["Tata Digital India Fund", 3000]], lumpsums: [] },
];

function monthsAgo(n: number, day = 5): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

export async function addSampleData(scope: Scope, pc: PracticeCrypto, assignTo: string | null): Promise<number> {
  const s = typeof scope === "string" ? { practiceId: scope } : scope;
  return withPractice(scope, async (tx) => {
    let added = 0;
    for (const [i, c] of SAMPLES.entries()) {
      const legacyId = `sample:${i + 1}`;
      const [exists] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.legacyId, legacyId));
      if (exists) continue;
      const id = crypto.randomUUID();
      await tx.insert(investors).values({
        id,
        practiceId: s.practiceId,
        name: c.name,
        mobile: c.mobile,
        email: c.email,
        address: `${10 + i} MG Road, ${c.city}`,
        dob: `19${60 + i * 3}-0${(i % 9) + 1}-15`,
        taxIdType: "PAN",
        taxIdEnc: await pc.encrypt("tax_id", id, c.pan),
        taxIdHash: await pc.taxIdHash(c.pan),
        taxIdLast4: c.pan.slice(-4),
        bankEnc: await pc.encrypt(
          "bank",
          id,
          JSON.stringify({ accountNo: `5010000000${String(i + 1).padStart(2, "0")}`, bankName: "HDFC Bank", ifsc: "HDFC0000001", micr: "400240001", branch: c.city }),
        ),
        nomineeEnc: await pc.encrypt(
          "nominee",
          id,
          JSON.stringify({ name: c.nominee[0], relation: c.nominee[1], dob: null, pan: null, mobile: null, email: null }),
        ),
        notes: "Sample client (made-up data). Remove it under Home → Remove sample data.",
        assignedUserId: assignTo,
        legacyId,
      });
      for (const [scheme, amount] of c.sips) {
        const startMonths = 12 + (i % 6);
        await tx.insert(sips).values({
          practiceId: s.practiceId,
          investorId: id,
          schemeText: scheme,
          amount: amount.toFixed(2),
          frequency: "monthly",
          startDate: monthsAgo(startMonths),
          status: i === 2 && scheme.includes("Small") ? "paused" : "active",
          source: "sample",
        });
        for (let m = startMonths; m >= 0; m--) {
          if (i === 2 && scheme.includes("Small") && m < 3) continue; // paused 3 months ago
          await tx.insert(transactions).values({
            practiceId: s.practiceId,
            investorId: id,
            schemeText: scheme,
            type: "sip",
            tradeDate: monthsAgo(m),
            amount: amount.toFixed(2),
            paymentMode: "mandate",
            source: "sample",
            sourceTxnId: crypto.randomUUID(),
          });
        }
      }
      for (const [scheme, amount, ago] of c.lumpsums) {
        await tx.insert(transactions).values({
          practiceId: s.practiceId,
          investorId: id,
          schemeText: scheme,
          type: "purchase",
          tradeDate: monthsAgo(ago, 18),
          amount: amount.toFixed(2),
          paymentMode: "online",
          reference: `SAMPLE${1000 + i}`,
          source: "sample",
          sourceTxnId: crypto.randomUUID(),
        });
      }
      added++;
    }
    return added;
  });
}

export async function removeSampleData(scope: Scope): Promise<number> {
  return withPractice(scope, async (tx) => {
    // Deleting the sample clients removes their SIPs and transactions too.
    const gone = await tx.delete(investors).where(like(investors.legacyId, "sample:%")).returning({ id: investors.id });
    await tx.delete(transactions).where(eq(transactions.source, "sample"));
    await tx.delete(sips).where(eq(sips.source, "sample"));
    return gone.length;
  });
}

export async function hasSampleData(scope: Scope): Promise<boolean> {
  return withPractice(scope, async (tx) => {
    const [row] = await tx.select({ id: investors.id }).from(investors).where(and(like(investors.legacyId, "sample:%"))).limit(1);
    return Boolean(row);
  });
}
