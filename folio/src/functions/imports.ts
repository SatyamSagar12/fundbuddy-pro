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
