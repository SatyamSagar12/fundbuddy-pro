/**
 * Registrar and CAS imports. Files are opened and read in the browser (their passwords never leave it); these
 * receive the transactions. Owners and staff only: a registrar report covers the whole practice.
 */
import { createServerFn } from "@tanstack/react-start";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { withPractice } from "@/server/db/scope";
import { investors } from "@/server/db/schema";
import { cryptoFor, requireMember, scopeOf } from "@/server/member";
import { applyImport, planImport } from "@/server/registrar-import";
import { importFundVault, OLD_SAMPLE_IDS, parseCsv } from "@/server/import-fundvault";
import { billingFor } from "@/server/billing";
import { audit } from "@/server/security";
import { confidentScheme, fillUnitsSoon, linkScheme } from "@/server/schemes";
import { unmatchedSchemeNames } from "@/server/valuation";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txn = z.object({
  ref: z.string().min(1).max(300),
  folio: z.string().min(1).max(40),
  amc: z.string().max(120).nullable(),
  scheme: z.string().min(1).max(250),
  isin: z.string().regex(/^IN[A-Z0-9]{10}$/).nullable(),
  rtaCode: z.string().max(40).nullable(),
  investorName: z.string().max(150).nullable(),
  pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).nullable(),
  type: z.enum(["purchase", "sip", "redemption", "switch_in", "switch_out", "idcw_reinvest", "idcw_payout"]),
  date,
  amount: z.number().finite().min(-1e11).max(1e11),
  units: z.number().finite().min(-1e10).max(1e10).nullable(),
  nav: z.number().finite().positive().max(1e9).nullable(),
  arn: z.string().max(20).nullable(),
  description: z.string().max(300),
});
const input = z.object({
  source: z.enum(["cams", "kfintech", "cas"]),
  fileName: z.string().max(200),
  investorId: z.uuid().optional(),
  txns: z.array(txn).min(1).max(20000),
});

export const previewImport = createServerFn({ method: "POST" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    return planImport(m, await cryptoFor(m.practiceId), data);
  });

export const runImport = createServerFn({ method: "POST" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    return applyImport(m, await cryptoFor(m.practiceId), data);
  });

/** Clients to pick from when a CAS statement's PAN isn't on any client yet. */
export const importClients = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  return withPractice(scopeOf(m), (tx) => tx.select({ id: investors.id, name: investors.name, panLast4: investors.taxIdLast4 }).from(investors).orderBy(asc(investors.name)));
});

const oldAppInput = z.object({
  clients: z.string().max(5_000_000),
  investments: z.string().max(5_000_000),
  sips: z.string().max(5_000_000),
  dryRun: z.boolean(),
});

/**
 * The old FundVault app's three CSV exports (clients, investments, SIPs). A dry run reports and saves nothing;
 * re-running is safe (rows keep their old ids). Owner only.
 */
export const importOldApp = createServerFn({ method: "POST" })
  .validator((data: unknown) => oldAppInput.parse(data))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    const parsed = { clients: parseCsv(data.clients), investments: parseCsv(data.investments), sips: parseCsv(data.sips) };
    const problem = checkColumns(parsed);
    if (problem) return { ok: false as const, error: problem };

    // Plan limit (a practice made free of charge in /platform has none).
    const billing = await billingFor(m.practiceId);
    if (billing.limits.clients !== null) {
      const legacy = new Set(parsed.clients.map((c) => c["id"]).filter((id): id is string => !!id && !OLD_SAMPLE_IDS.has(id)));
      const existing = await withPractice(m.practiceId, (tx) => tx.select({ legacyId: investors.legacyId }).from(investors));
      const already = new Set(existing.map((e) => e.legacyId));
      const added = [...legacy].filter((id) => !already.has(id)).length;
      if (existing.length + added > billing.limits.clients) {
        return {
          ok: false as const,
          error: `This brings ${added} clients; your plan allows ${billing.limits.clients}. Ask the Anqulas admin to make this practice free of charge, or choose a bigger plan.`,
        };
      }
    }

    const report = await importFundVault(m.practiceId, await cryptoFor(m.practiceId), parsed, { dryRun: data.dryRun });
    const t = report.totals;
    const totalsMatch = Math.abs(t.oldInvested - t.newInvested) < 0.01 && t.oldActiveSips === t.newActiveSips;
    if (!data.dryRun) {
      await audit(m.practiceId, m.userId, "import.old_app", { meta: { clients: report.clients.imported, investments: report.investments.imported, sips: report.sips.imported, totalsMatch } });
      // Scheme names typed in the old app: link the certain ones, so their value shows straight away.
      const names = await withPractice(scopeOf(m), (tx) => unmatchedSchemeNames(tx));
      let linked = 0;
      for (const n of names) {
        const id = await confidentScheme(n.scheme).catch(() => null);
        if (id) {
          await linkScheme(scopeOf(m), n.scheme, id);
          linked++;
        }
      }
      if (linked) await fillUnitsSoon(m.practiceId);
    }
    return { ok: true as const, report, totalsMatch };
  });

const NEEDED: Record<"clients" | "investments" | "sips", string[]> = {
  clients: ["id", "name"],
  investments: ["id", "client_id", "scheme", "amount", "date"],
  sips: ["id", "client_id", "scheme", "amount", "start_date"],
};

function checkColumns(data: Record<"clients" | "investments" | "sips", Record<string, string>[]>): string | null {
  for (const [table, cols] of Object.entries(NEEDED) as ["clients" | "investments" | "sips", string[]][]) {
    const rows = data[table];
    if (!rows.length) continue;
    const missing = cols.filter((c) => !(c in rows[0]!));
    if (missing.length) return `The ${table} file has no ${missing.join(", ")} column. Is it the ${table} table's CSV export from the old app?`;
  }
  if (!data.clients.length) return "The clients file is empty.";
  return null;
}
