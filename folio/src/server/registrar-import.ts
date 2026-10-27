/**
 * Importing registrar transactions (CAMS / KFintech reports, CAS statements) into a practice.
 *
 * The files are read in the browser (src/lib/imports); this receives their transactions and decides, for each:
 *  - the client: the one chosen (CAS), else by PAN, else by folio, else by the exact name when only one client
 *    has it, else a new client (with the PAN encrypted like any other);
 *  - the scheme: by ISIN, else by an exact name match, else left to "Match schemes";
 *  - whether it's already in: re-sent files and overlapping statements add nothing twice;
 *  - whether it replaces an entry typed by hand: same client, same direction, amount within ₹1, date within 5
 *    days, same scheme. The registrar's figures (exact units) win; the typed one is removed.
 *
 * `planImport` only reads and reports; `applyImport` does the same work and saves it in one transaction.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "./db/client";
import { withPractice, type Tx } from "./db/scope";
import { folios, instruments, investors, practices, transactions } from "./db/schema";
import { normaliseTaxId, type PracticeCrypto } from "./crypto";
import { confidentScheme, fillUnitsSoon } from "./schemes";
import { audit } from "./security";
import { billingFor } from "./billing";
import type { Member } from "./member";
import { scopeOf } from "./member";
import { baseName } from "@/lib/scheme-match";
import { OUT_TYPES, type ImportSource, type ImportTxn } from "@/lib/imports/normalise";

export type ImportInput = { source: ImportSource; txns: ImportTxn[]; investorId?: string | undefined; fileName: string };

type ClientPlan = { key: string; name: string; panLast4: string | null; investorId: string | null; entries: number };

export type ImportPlan = {
  total: number;
  toAdd: number;
  alreadyIn: number;
  replacesTyped: number;
  clients: ClientPlan[];
  newClients: number;
  schemesMatched: number;
  schemesUnmatched: string[];
  heldAway: number;
  from: string | null;
  to: string | null;
  byType: Record<string, number>;
  error: string | null;
};

const DAY = 86400000;
const IN_GROUP = new Set(["purchase", "sip", "switch_in"]);
const groupOf = (type: string) => (IN_GROUP.has(type) ? "in" : OUT_TYPES.includes(type as never) ? "out" : type);
const folioKey = (f: string) => f.replace(/\s+/g, "").toUpperCase();

async function work(tx: Tx, m: Member, pc: PracticeCrypto, input: ImportInput, save: boolean) {
  const txns = input.txns;
  // ── Clients ────────────────────────────────────────────────────────────────
  const people = await tx.select({ id: investors.id, name: investors.name, hash: investors.taxIdHash }).from(investors);
  const byHash = new Map(people.filter((p) => p.hash).map((p) => [p.hash!, p.id]));
  const byName = new Map<string, string[]>();
  for (const p of people) {
    const k = p.name.trim().toLowerCase().replace(/\s+/g, " ");
    byName.set(k, [...(byName.get(k) ?? []), p.id]);
  }
  const existingFolios = await tx.select({ id: folios.id, investorId: folios.investorId, amc: folios.amc, folioNo: folios.folioNo }).from(folios);
  const folioOwner = new Map(existingFolios.map((f) => [folioKey(f.folioNo), f.investorId]));
  const panHash = new Map<string, string>();
  for (const pan of new Set(txns.map((t) => t.pan).filter((p): p is string => !!p))) panHash.set(pan, await pc.taxIdHash(pan));
  if (input.investorId && !people.some((p) => p.id === input.investorId)) throw new Error("Client not found.");

  // A key per client in the file: PAN when given, else folio owner, else name.
  const clientOf = (t: ImportTxn): { key: string; investorId: string | null } => {
    if (input.investorId) return { key: `id:${input.investorId}`, investorId: input.investorId };
    if (t.pan) {
      const id = byHash.get(panHash.get(t.pan)!);
      if (id) return { key: `id:${id}`, investorId: id };
    }
    const owner = folioOwner.get(folioKey(t.folio));
    if (owner) return { key: `id:${owner}`, investorId: owner };
    if (!t.pan && t.investorName) {
      const same = byName.get(t.investorName.trim().toLowerCase().replace(/\s+/g, " ")) ?? [];
      if (same.length === 1) return { key: `id:${same[0]}`, investorId: same[0]! };
    }
    return { key: t.pan ? `pan:${t.pan}` : `name:${(t.investorName ?? t.folio).toLowerCase()}`, investorId: null };
  };

  // ── Schemes ────────────────────────────────────────────────────────────────
  const isins = [...new Set(txns.map((t) => t.isin).filter((i): i is string => !!i))];
  const byIsin = new Map<string, { id: string; amc: string | null; name: string }>();
  for (let i = 0; i < isins.length; i += 500) {
    const chunk = isins.slice(i, i + 500);
    const rows = await tx
      .select({ id: instruments.id, amc: instruments.amc, name: instruments.name, isin: instruments.isin, isinReinvest: instruments.isinReinvest })
      .from(instruments)
      .where(or(inArray(instruments.isin, chunk), inArray(instruments.isinReinvest, chunk)));
    for (const r of rows) {
      if (r.isin) byIsin.set(r.isin, r);
      if (r.isinReinvest) byIsin.set(r.isinReinvest, r);
    }
  }
  const byName2 = new Map<string, string | null>();
  const instrumentOf = async (t: ImportTxn): Promise<string | null> => {
    if (t.isin && byIsin.has(t.isin)) return byIsin.get(t.isin)!.id;
    if (!byName2.has(t.scheme)) byName2.set(t.scheme, await confidentScheme(t.scheme).catch(() => null));
    return byName2.get(t.scheme)!;
  };

  // ── Already imported ───────────────────────────────────────────────────────
  const refs = [...new Set(txns.map((t) => t.ref))];
  const known = new Set<string>();
  for (let i = 0; i < refs.length; i += 1000) {
    const rows = await tx
      .select({ ref: transactions.sourceTxnId })
      .from(transactions)
      .where(and(eq(transactions.source, input.source), inArray(transactions.sourceTxnId, refs.slice(i, i + 1000))));
    for (const r of rows) known.add(r.ref!);
  }

  // ── The same transaction from another registrar source (a CAMS report and a CAS overlap) ─
  const registrarRows = await tx
    .select({ investorId: transactions.investorId, folioNo: folios.folioNo, date: transactions.tradeDate, type: transactions.type, units: transactions.units })
    .from(transactions)
    .innerJoin(folios, eq(folios.id, transactions.folioId))
    .where(inArray(transactions.source, ["cams", "kfintech", "cas"]));
  const sameTxn = (investorId: string, folio: string, date: string, type: string, units: number | null) =>
    `${investorId}|${folioKey(folio)}|${date}|${groupOf(type)}|${units === null ? "-" : Math.abs(units).toFixed(3)}`;
  const otherSource = new Set(registrarRows.map((r) => sameTxn(r.investorId, r.folioNo, r.date, r.type, r.units === null ? null : Number(r.units))));

  // ── Typed entries the registrar's own records replace ──────────────────────
  const typed = await tx
    .select({
      id: transactions.id,
      investorId: transactions.investorId,
      instrumentId: transactions.instrumentId,
      scheme: transactions.schemeText,
      type: transactions.type,
      amount: transactions.amount,
      date: transactions.tradeDate,
    })
    .from(transactions)
    .where(inArray(transactions.source, ["manual", "legacy", "sample"]));
  const usedTyped = new Set<string>();

  const [practice] = await db().select({ arn: practices.arn }).from(practices).where(eq(practices.id, m.practiceId));
  const ourArn = practice?.arn?.toUpperCase() ?? null;

  // ── Decide every row ───────────────────────────────────────────────────────
  type Row = { t: ImportTxn; clientKey: string; investorId: string | null; instrumentId: string | null; replaces: string | null };
  const rows: Row[] = [];
  const seen = new Set<string>();
  let alreadyIn = 0;
  for (const t of txns) {
    if (known.has(t.ref) || seen.has(t.ref)) {
      alreadyIn++;
      continue;
    }
    seen.add(t.ref);
    const c = clientOf(t);
    if (c.investorId && t.units !== null && otherSource.has(sameTxn(c.investorId, t.folio, t.date, t.type, t.units))) {
      alreadyIn++;
      continue;
    }
    const instrumentId = await instrumentOf(t);
    let replaces: string | null = null;
    if (c.investorId) {
      const hit = typed.find(
        (x) =>
          !usedTyped.has(x.id) &&
          x.investorId === c.investorId &&
          groupOf(x.type) === groupOf(t.type) &&
          Math.abs(Number(x.amount) - Math.abs(t.amount)) <= 1 &&
          Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 5 * DAY &&
          (x.instrumentId ? x.instrumentId === instrumentId : !!x.scheme && baseName(x.scheme) === baseName(t.scheme)),
      );
      if (hit) {
        usedTyped.add(hit.id);
        replaces = hit.id;
      }
    }
    rows.push({ t, clientKey: c.key, investorId: c.investorId, instrumentId, replaces });
  }

  const clients = new Map<string, ClientPlan>();
  for (const r of rows) {
    const p = clients.get(r.clientKey) ?? {
      key: r.clientKey,
      name: r.investorId ? (people.find((x) => x.id === r.investorId)?.name ?? "") : (r.t.investorName ?? `Folio ${r.t.folio}`),
      panLast4: r.t.pan ? r.t.pan.slice(-4) : null,
      investorId: r.investorId,
      entries: 0,
    };
    p.entries++;
    clients.set(r.clientKey, p);
  }
  const newClients = [...clients.values()].filter((c) => !c.investorId).length;
  const unmatched = [...new Set(rows.filter((r) => !r.instrumentId).map((r) => r.t.scheme))];
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.t.type] = (byType[r.t.type] ?? 0) + 1;
  const isAway = (t: ImportTxn) => !!t.arn && !!ourArn && t.arn !== ourArn;
  const dates = rows.map((r) => r.t.date).sort();

  let error: string | null = null;
  if (newClients) {
    const limit = (await billingFor(m.practiceId)).limits.clients;
    if (limit !== null && people.length + newClients > limit) {
      error = `This would add ${newClients} new clients, over your plan's ${limit}. Choose a bigger plan in Settings → Billing, or import fewer clients.`;
    }
  }

  const plan: ImportPlan = {
    total: txns.length,
    toAdd: rows.length,
    alreadyIn,
    replacesTyped: rows.filter((r) => r.replaces).length,
    clients: [...clients.values()].sort((a, b) => b.entries - a.entries),
    newClients,
    schemesMatched: new Set(rows.filter((r) => r.instrumentId).map((r) => r.instrumentId)).size,
    schemesUnmatched: unmatched,
    heldAway: rows.filter((r) => isAway(r.t)).length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    byType,
    error,
  };
  if (!save || error || !rows.length) return { plan, added: 0 };

  // ── Save ───────────────────────────────────────────────────────────────────
  const investorFor = new Map<string, string>();
  for (const c of clients.values()) {
    if (c.investorId) {
      investorFor.set(c.key, c.investorId);
      continue;
    }
    const sample = rows.find((r) => r.clientKey === c.key)!.t;
    const id = crypto.randomUUID();
    const pan = sample.pan ? normaliseTaxId(sample.pan) : null;
    await tx.insert(investors).values({
      id,
      practiceId: m.practiceId,
      name: titleCase(sample.investorName ?? `Folio ${sample.folio}`),
      taxIdType: "PAN",
      taxIdEnc: pan ? await pc.encrypt("tax_id", id, pan) : null,
      taxIdHash: pan ? panHash.get(sample.pan!)! : null,
      taxIdLast4: pan ? pan.slice(-4) : null,
      notes: `Added from ${input.fileName} (${SOURCE_LABEL[input.source]}).`,
      assignedUserId: m.role === "subbroker" ? m.userId : null,
    });
    investorFor.set(c.key, id);
  }

  // The fund house as AMFI names it, from the matched scheme; else as the file gives it.
  const matchedIds = [...new Set(rows.map((r) => r.instrumentId).filter((x): x is string => !!x))];
  const amcById = new Map<string, string | null>();
  for (let i = 0; i < matchedIds.length; i += 500) {
    for (const r of await tx.select({ id: instruments.id, amc: instruments.amc }).from(instruments).where(inArray(instruments.id, matchedIds.slice(i, i + 500)))) {
      amcById.set(r.id, r.amc);
    }
  }
  const amcOf = (r: Row) => (r.instrumentId && amcById.get(r.instrumentId)) || r.t.amc || "";
  const folioIds = new Map<string, string>();
  for (const f of existingFolios) folioIds.set(`${f.investorId}|${folioKey(f.folioNo)}`, f.id);
  for (const r of rows) {
    const investorId = investorFor.get(r.clientKey)!;
    const k = `${investorId}|${folioKey(r.t.folio)}`;
    if (folioIds.has(k)) continue;
    const [f] = await tx
      .insert(folios)
      .values({ practiceId: m.practiceId, investorId, amc: amcOf(r), folioNo: r.t.folio, heldAway: isAway(r.t) })
      .onConflictDoNothing()
      .returning({ id: folios.id });
    if (f) folioIds.set(k, f.id);
  }

  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => {
      const investorId = investorFor.get(r.clientKey)!;
      return {
        practiceId: m.practiceId,
        investorId,
        folioId: folioIds.get(`${investorId}|${folioKey(r.t.folio)}`) ?? null,
        instrumentId: r.instrumentId,
        schemeText: r.t.scheme,
        type: r.t.type,
        tradeDate: r.t.date,
        amount: r.t.amount.toFixed(2),
        units: r.t.units === null ? null : r.t.units.toFixed(4),
        nav: r.t.nav === null ? null : r.t.nav.toFixed(6),
        unitsEstimated: false,
        reference: r.t.description.slice(0, 120) || null,
        source: input.source,
        sourceTxnId: r.t.ref,
      };
    });
    const inserted = await tx.insert(transactions).values(chunk).onConflictDoNothing().returning({ id: transactions.id });
    added += inserted.length;
  }
  const replaced = rows.map((r) => r.replaces).filter((x): x is string => !!x);
  for (let i = 0; i < replaced.length; i += 500) await tx.delete(transactions).where(inArray(transactions.id, replaced.slice(i, i + 500)));
  return { plan, added };
}

const SOURCE_LABEL: Record<ImportSource, string> = { cams: "CAMS report", kfintech: "KFintech report", cas: "CAS statement" };

function titleCase(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name;
}

export async function planImport(m: Member, pc: PracticeCrypto, input: ImportInput): Promise<ImportPlan> {
  return withPractice(scopeOf(m), async (tx) => (await work(tx, m, pc, input, false)).plan);
}

export async function applyImport(m: Member, pc: PracticeCrypto, input: ImportInput): Promise<{ plan: ImportPlan; added: number }> {
  const result = await withPractice(scopeOf(m), (tx) => work(tx, m, pc, input, true));
  if (result.added) {
    await audit(m.practiceId, m.userId, "import.registrar", {
      meta: { source: input.source, file: input.fileName.slice(0, 120), added: result.added, replaced: result.plan.replacesTyped, newClients: result.plan.newClients },
    });
    // Rows without units (rare in registrar files) get them from NAVs like typed ones.
    await fillUnitsSoon(m.practiceId);
  }
  return result;
}
