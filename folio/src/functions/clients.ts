/**
 * One client: view (decrypted for the signed-in team member), add, edit, delete.
 * PAN, bank and nominee details are encrypted with the practice's key; the list only ever sees XXXXXX234F.
 */
import { createServerFn } from "@tanstack/react-start";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { investors, sips, transactions } from "@/server/db/schema";
import { cryptoFor, requireMember, scopeOf } from "@/server/member";
import { billingFor } from "@/server/billing";
import { audit } from "@/server/security";
import { normaliseTaxId } from "@/server/crypto";
import { clientSchema, EMPTY_CLIENT, type ClientForm } from "@/lib/records";

type Bank = { accountNo: string | null; bankName: string | null; ifsc: string | null; micr: string | null; branch: string | null };
type Nominee = { name: string | null; dob: string | null; pan: string | null; mobile: string | null; email: string | null; relation: string | null };

const idInput = z.object({ id: z.uuid() });

export const getClient = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const pc = await cryptoFor(m.practiceId);
    return withPractice(scopeOf(m), async (tx) => {
      const [c] = await tx.select().from(investors).where(eq(investors.id, data.id));
      if (!c) return null;
      const bank: Partial<Bank> = c.bankEnc ? JSON.parse(await pc.decrypt("bank", c.id, c.bankEnc)) : {};
      const nominee: Partial<Nominee> = c.nomineeEnc ? JSON.parse(await pc.decrypt("nominee", c.id, c.nomineeEnc)) : {};
      const pan = c.taxIdEnc ? await pc.decrypt("tax_id", c.id, c.taxIdEnc) : "";
      const form: ClientForm = {
        ...EMPTY_CLIENT,
        name: c.name,
        mobile: c.mobile ?? "",
        email: c.email ?? "",
        address: c.address ?? "",
        pan,
        dob: c.dob ?? "",
        bankAccountNo: bank.accountNo ?? "",
        bankName: bank.bankName ?? "",
        ifsc: bank.ifsc ?? "",
        micr: bank.micr ?? "",
        branch: bank.branch ?? "",
        nomineeName: nominee.name ?? "",
        nomineeDob: nominee.dob ?? "",
        nomineePan: nominee.pan ?? "",
        nomineeMobile: nominee.mobile ?? "",
        nomineeEmail: nominee.email ?? "",
        nomineeRelation: nominee.relation ?? "",
        notes: c.notes ?? "",
      };
      const txns = await tx
        .select({
          id: transactions.id,
          scheme: transactions.schemeText,
          type: transactions.type,
          amount: transactions.amount,
          date: transactions.tradeDate,
          paymentMode: transactions.paymentMode,
          reference: transactions.reference,
        })
        .from(transactions)
        .where(eq(transactions.investorId, c.id))
        .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt));
      const clientSips = await tx
        .select({
          id: sips.id,
          scheme: sips.schemeText,
          amount: sips.amount,
          frequency: sips.frequency,
          startDate: sips.startDate,
          status: sips.status,
        })
        .from(sips)
        .where(eq(sips.investorId, c.id))
        .orderBy(desc(sips.startDate));
      return {
        id: c.id,
        form,
        createdAt: c.createdAt,
        transactions: txns.map((t) => ({ ...t, amount: Number(t.amount) })),
        sips: clientSips.map((s) => ({ ...s, amount: Number(s.amount) })),
        canDelete: m.role !== "subbroker",
      };
    });
  });

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

export const saveClient = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid().optional(), client: clientSchema }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const c = data.client;
    if (!data.id) {
      const limit = (await billingFor(m.practiceId)).limits.clients;
      if (limit !== null) {
        const [n] = await db().select({ n: count() }).from(investors).where(eq(investors.practiceId, m.practiceId));
        if ((n?.n ?? 0) >= limit) {
          return { ok: false as const, error: `Your plan allows ${limit} clients. Choose a bigger plan in Settings → Billing.` };
        }
      }
    }
    const pc = await cryptoFor(m.practiceId);
    const id = data.id ?? crypto.randomUUID();
    const bank: Bank = { accountNo: blank(c.bankAccountNo), bankName: blank(c.bankName), ifsc: blank(c.ifsc), micr: blank(c.micr), branch: blank(c.branch) };
    const nominee: Nominee = {
      name: blank(c.nomineeName),
      dob: blank(c.nomineeDob),
      pan: blank(c.nomineePan),
      mobile: blank(c.nomineeMobile),
      email: blank(c.nomineeEmail),
      relation: blank(c.nomineeRelation),
    };
    const any = (o: object) => Object.values(o).some((v) => v !== null);
    const pan = blank(c.pan);
    const row = {
      name: c.name,
      mobile: blank(c.mobile),
      email: blank(c.email),
      address: blank(c.address),
      dob: blank(c.dob),
      taxIdType: "PAN",
      taxIdEnc: pan ? await pc.encrypt("tax_id", id, normaliseTaxId(pan)) : null,
      taxIdHash: pan ? await pc.taxIdHash(pan) : null,
      taxIdLast4: pan ? normaliseTaxId(pan).slice(-4) : null,
      bankEnc: any(bank) ? await pc.encrypt("bank", id, JSON.stringify(bank)) : null,
      nomineeEnc: any(nominee) ? await pc.encrypt("nominee", id, JSON.stringify(nominee)) : null,
      notes: blank(c.notes),
      updatedAt: new Date(),
    };
    const saved = await withPractice(scopeOf(m), async (tx) => {
      if (data.id) {
        return tx.update(investors).set(row).where(eq(investors.id, id)).returning({ id: investors.id });
      }
      // A sub-broker's new client is theirs; the database refuses anything else for them.
      return tx
        .insert(investors)
        .values({ id, practiceId: m.practiceId, assignedUserId: m.role === "subbroker" ? m.userId : null, ...row })
        .returning({ id: investors.id });
    });
    if (!saved.length) return { ok: false as const, error: "Client not found." };
    await audit(m.practiceId, m.userId, data.id ? "client.updated" : "client.created", { target: id });
    return { ok: true as const, id };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    const gone = await withPractice(scopeOf(m), (tx) =>
      tx.delete(investors).where(eq(investors.id, data.id)).returning({ name: investors.name }),
    );
    if (!gone.length) return { ok: false as const, error: "Client not found." };
    await audit(m.practiceId, m.userId, "client.deleted", { target: data.id });
    return { ok: true as const };
  });
