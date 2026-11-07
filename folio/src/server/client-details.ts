/**
 * Client details from registrar reports: fills a client's empty mobile, email, address and date of birth, and
 * adds clients the practice doesn't have yet (investor / folio master reports list every client).
 *
 * Matching, like transactions: PAN, else folio, else an exact name only one client has. What someone typed is
 * never overwritten; only empty fields are filled.
 */
import { eq } from "drizzle-orm";
import { withPractice } from "./db/scope";
import { folios, investors } from "./db/schema";
import { normaliseTaxId, type PracticeCrypto } from "./crypto";
import { billingFor } from "./billing";
import { audit } from "./security";
import type { Member } from "./member";
import { scopeOf } from "./member";
import type { ContactRow } from "@/lib/imports/contacts";

export type DetailsResult = { updated: number; created: number; skippedOverLimit: number };

const folioKey = (f: string) => f.replace(/\s+/g, "").toUpperCase();
const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
const titleCase = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n);

export async function applyClientDetails(m: Member, pc: PracticeCrypto, rows: ContactRow[], from: string): Promise<DetailsResult> {
  if (!rows.length) return { updated: 0, created: 0, skippedOverLimit: 0 };
  const limit = (await billingFor(m.practiceId)).limits.clients;
  const panHash = new Map<string, string>();
  for (const pan of new Set(rows.map((r) => r.pan).filter((p): p is string => !!p))) panHash.set(pan, await pc.taxIdHash(pan));

  const result = await withPractice(scopeOf(m), async (tx) => {
    const people = await tx
      .select({ id: investors.id, name: investors.name, hash: investors.taxIdHash, email: investors.email, mobile: investors.mobile, address: investors.address, dob: investors.dob })
      .from(investors);
    const byId = new Map(people.map((p) => [p.id, { ...p }]));
    const byHash = new Map(people.filter((p) => p.hash).map((p) => [p.hash!, p.id]));
    const byName = new Map<string, string[]>();
    for (const p of people) byName.set(nameKey(p.name), [...(byName.get(nameKey(p.name)) ?? []), p.id]);
    const folioOwner = new Map(
      (await tx.select({ investorId: folios.investorId, folioNo: folios.folioNo }).from(folios)).map((f) => [folioKey(f.folioNo), f.investorId]),
    );

    let count = people.length;
    let created = 0;
    let skippedOverLimit = 0;
    const changed = new Set<string>();
    for (const r of rows) {
      let id = (r.pan && byHash.get(panHash.get(r.pan)!)) || (r.folio && folioOwner.get(folioKey(r.folio))) || null;
      if (!id && r.name && !r.pan) {
        const same = byName.get(nameKey(r.name)) ?? [];
        if (same.length === 1) id = same[0]!;
      }
      if (!id) {
        // A client the practice doesn't have yet: only with a name and a PAN, so it can be matched next time.
        if (!r.name || !r.pan) continue;
        if (limit !== null && count >= limit) {
          skippedOverLimit++;
          continue;
        }
        id = crypto.randomUUID();
        const pan = normaliseTaxId(r.pan);
        await tx.insert(investors).values({
          id,
          practiceId: m.practiceId,
          name: titleCase(r.name),
          email: r.email,
          mobile: r.mobile,
          address: r.address,
          dob: r.dob,
          taxIdType: "PAN",
          taxIdEnc: await pc.encrypt("tax_id", id, pan),
          taxIdHash: panHash.get(r.pan)!,
          taxIdLast4: pan.slice(-4),
          notes: `Added from ${from}.`,
          assignedUserId: m.role === "subbroker" ? m.userId : null,
        });
        byId.set(id, { id, name: r.name, hash: panHash.get(r.pan)!, email: r.email, mobile: r.mobile, address: r.address, dob: r.dob });
        byHash.set(panHash.get(r.pan)!, id);
        count++;
        created++;
      } else {
        const p = byId.get(id);
        if (!p) continue;
        const set: Partial<{ email: string; mobile: string; address: string; dob: string }> = {};
        if (!p.email && r.email) set.email = p.email = r.email;
        if (!p.mobile && r.mobile) set.mobile = p.mobile = r.mobile;
        if (!p.address && r.address) set.address = p.address = r.address;
        if (!p.dob && r.dob) set.dob = p.dob = r.dob;
        if (Object.keys(set).length) {
          await tx.update(investors).set({ ...set, updatedAt: new Date() }).where(eq(investors.id, id));
          changed.add(id);
        }
      }
      // Remember the folio, so transactions arriving later find this client.
      if (r.folio && r.amc && !folioOwner.has(folioKey(r.folio))) {
        await tx.insert(folios).values({ practiceId: m.practiceId, investorId: id, amc: r.amc, folioNo: r.folio }).onConflictDoNothing();
        folioOwner.set(folioKey(r.folio), id);
      }
    }
    return { updated: changed.size, created, skippedOverLimit };
  });
  if (result.updated || result.created) {
    await audit(m.practiceId, m.userId, "import.client_details", { meta: { from: from.slice(0, 120), ...result } });
  }
  return result;
}

