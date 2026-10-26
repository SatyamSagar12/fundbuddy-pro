/**
 * Imports the old FundVault Lite (Lovable) data into a practice: clients, investments, SIPs.
 *
 * - Safe to re-run: every row keeps its old id (legacy_id / source_txn_id), so a second run updates nothing
 *   twice and adds only rows that are new.
 * - PAN, bank and nominee details are encrypted with the practice's own key before they are written.
 * - The four sample clients the old app was created with (ids 1111…, 2222…, 3333…, 4444…) are skipped.
 * - Scheme names stay as typed; matching them to AMFI schemes comes with the scheme master (phase 2).
 */
import { and, eq, sql } from "drizzle-orm";
import { withPractice } from "./db/scope";
import { investors, sips, transactions } from "./db/schema";
import { normaliseTaxId, type PracticeCrypto } from "./crypto";

export type OldClient = Record<string, string>;
export type OldInvestment = Record<string, string>;
export type OldSip = Record<string, string>;

const SAMPLE_IDS = new Set([
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
  "44444444-4444-4444-4444-444444444444",
]);

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" || v === "NULL" ? null : v.trim());

export type ImportReport = {
  clients: { imported: number; skippedSamples: number };
  investments: { imported: number; skipped: string[] };
  sips: { imported: number; skipped: string[] };
  totals: { oldInvested: number; newInvested: number; oldActiveSips: number; newActiveSips: number };
};

/** Thrown inside the transaction to roll a dry run back; carries the report. */
class RollBack extends Error {
  constructor(readonly report: ImportReport) {
    super("dry run");
  }
}

export async function importFundVault(
  practiceId: string,
  pc: PracticeCrypto,
  data: { clients: OldClient[]; investments: OldInvestment[]; sips: OldSip[] },
  options: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  try {
    return await importInTransaction(practiceId, pc, data, options.dryRun ?? false);
  } catch (e) {
    if (e instanceof RollBack) return e.report;
    throw e;
  }
}

async function importInTransaction(
  practiceId: string,
  pc: PracticeCrypto,
  data: { clients: OldClient[]; investments: OldInvestment[]; sips: OldSip[] },
  dryRun: boolean,
): Promise<ImportReport> {
  const report: ImportReport = {
    clients: { imported: 0, skippedSamples: 0 },
    investments: { imported: 0, skipped: [] },
    sips: { imported: 0, skipped: [] },
    totals: { oldInvested: 0, newInvested: 0, oldActiveSips: 0, newActiveSips: 0 },
  };

  return withPractice(practiceId, async (tx) => {
    const idByLegacy = new Map<string, string>();

    for (const c of data.clients) {
      const legacyId = blank(c["id"]);
      if (!legacyId) continue;
      if (SAMPLE_IDS.has(legacyId)) {
        report.clients.skippedSamples++;
        continue;
      }
      const name = blank(c["name"]);
      if (!name) throw new Error(`Client ${legacyId} has no name`);

      // The investor id is fixed first, because each encrypted field is bound to its record.
      const [existing] = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(eq(investors.practiceId, practiceId), eq(investors.legacyId, legacyId)));
      const id = existing?.id ?? crypto.randomUUID();

      const pan = blank(c["pan"]);
      const bank = {
        accountNo: blank(c["bank_account_no"]),
        bankName: blank(c["bank_name"]),
        ifsc: blank(c["ifsc_code"]),
        micr: blank(c["micr_code"]),
        branch: blank(c["branch_name"]),
      };
      const nominee = {
        name: blank(c["nominee_name"]),
        dob: blank(c["nominee_dob"]),
        pan: blank(c["nominee_pan"]),
        mobile: blank(c["nominee_mobile"]),
        email: blank(c["nominee_email"]),
        relation: blank(c["nominee_relation"]),
      };
      const hasAny = (o: Record<string, string | null>) => Object.values(o).some((v) => v !== null);

      const row = {
        practiceId,
        name,
        mobile: blank(c["mobile"]),
        email: blank(c["email"]),
        address: blank(c["address"]),
        dob: blank(c["dob"]),
        taxIdType: "PAN",
        taxIdEnc: pan ? await pc.encrypt("tax_id", id, normaliseTaxId(pan)) : null,
        taxIdHash: pan ? await pc.taxIdHash(pan) : null,
        taxIdLast4: pan ? normaliseTaxId(pan).slice(-4) : null,
        bankEnc: hasAny(bank) ? await pc.encrypt("bank", id, JSON.stringify(bank)) : null,
        nomineeEnc: hasAny(nominee) ? await pc.encrypt("nominee", id, JSON.stringify(nominee)) : null,
        legacyId,
        updatedAt: new Date(),
      };
      if (existing) await tx.update(investors).set(row).where(eq(investors.id, id));
      else await tx.insert(investors).values({ id, ...row });
      idByLegacy.set(legacyId, id);
      report.clients.imported++;
    }

    for (const inv of data.investments) {
      const legacyId = blank(inv["id"]);
      const clientLegacy = blank(inv["client_id"]);
      if (!legacyId || !clientLegacy) continue;
      if (SAMPLE_IDS.has(clientLegacy)) continue;
      const investorId = idByLegacy.get(clientLegacy);
      const amount = Number(inv["amount"]);
      if (!investorId || !Number.isFinite(amount)) {
        report.investments.skipped.push(`${legacyId}: ${investorId ? "bad amount" : "client not found"}`);
        continue;
      }
      report.totals.oldInvested += amount;
      await tx
        .insert(transactions)
        .values({
          practiceId,
          investorId,
          schemeText: blank(inv["scheme"]),
          type: inv["type"] === "SIP" ? "sip" : "purchase",
          tradeDate: blank(inv["date"]) ?? new Date().toISOString().slice(0, 10),
          amount: amount.toFixed(2),
          paymentMode: blank(inv["payment_mode"])?.toLowerCase() ?? null,
          reference: blank(inv["transaction_id"]),
          source: "legacy",
          sourceTxnId: legacyId,
        })
        .onConflictDoNothing();
      report.investments.imported++;
    }

    for (const s of data.sips) {
      const legacyId = blank(s["id"]);
      const clientLegacy = blank(s["client_id"]);
      if (!legacyId || !clientLegacy) continue;
      if (SAMPLE_IDS.has(clientLegacy)) continue;
      const investorId = idByLegacy.get(clientLegacy);
      const amount = Number(s["amount"]);
      if (!investorId || !Number.isFinite(amount)) {
        report.sips.skipped.push(`${legacyId}: ${investorId ? "bad amount" : "client not found"}`);
        continue;
      }
      const status = (blank(s["status"]) ?? "Active").toLowerCase();
      if (status === "active") report.totals.oldActiveSips++;
      await tx
        .insert(sips)
        .values({
          practiceId,
          investorId,
          schemeText: blank(s["scheme"]),
          amount: amount.toFixed(2),
          frequency: (blank(s["frequency"]) ?? "Monthly").toLowerCase(),
          startDate: blank(s["start_date"]) ?? new Date().toISOString().slice(0, 10),
          status,
          source: "legacy",
          legacyId,
        })
        .onConflictDoNothing();
      report.sips.imported++;
    }

    // Read back what is now stored, to compare with the old app's numbers.
    const [inv] = await tx
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text` })
      .from(transactions)
      .where(eq(transactions.source, "legacy"));
    const [act] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sips)
      .where(and(eq(sips.source, "legacy"), eq(sips.status, "active")));
    report.totals.newInvested = Number(inv?.total ?? 0);
    report.totals.newActiveSips = act?.n ?? 0;
    if (dryRun) throw new RollBack(report);
    return report;
  });
}

/** Minimal CSV reader (RFC 4180: quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}
