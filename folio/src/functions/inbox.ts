/** Email import settings (forwarding address, mailback ZIP password, received emails) and the morning summary. */
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { inboxMessages, memberships, practices } from "@/server/db/schema";
import { cryptoFor, requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { ensureInboxCode, inboundDomain, processMessage, retryWaiting, type InboxDetail } from "@/server/inbox";
import { emailWorks } from "@/server/mailer";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  const domain = inboundDomain();
  const code = domain ? await ensureInboxCode(m.practiceId) : null;
  const [p] = await db().select({ enc: practices.mailbackPasswordEnc }).from(practices).where(eq(practices.id, m.practiceId));
  const messages = await withPractice(scopeOf(m), (tx) =>
    tx
      .select({
        id: inboxMessages.id,
        receivedAt: inboxMessages.receivedAt,
        from: inboxMessages.fromAddress,
        subject: inboxMessages.subject,
        kind: inboxMessages.kind,
        status: inboxMessages.status,
        detail: inboxMessages.detail,
      })
      .from(inboxMessages)
      .orderBy(desc(inboxMessages.receivedAt))
      .limit(40),
  );
  const rows = messages.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString(), detail: r.detail as InboxDetail }));
  // Gmail's confirmation is worth showing until the first registrar email has come through after it.
  const confirm = rows.find((r) => r.kind === "forward_confirm");
  const mailbackAfter = confirm && rows.some((r) => r.kind === "mailback" && r.receivedAt > confirm.receivedAt);
  return {
    address: code && domain ? `${code}@${domain}` : null,
    hasPassword: Boolean(p?.enc),
    canRenew: m.role === "owner",
    /** Forwarding confirmed: a registrar email has arrived since Gmail's confirmation (or at all). */
    forwarding: Boolean(mailbackAfter) || rows.some((r) => r.kind === "mailback"),
    confirmation: confirm && !mailbackAfter ? { code: confirm.detail.code ?? null, link: confirm.detail.link ?? null, requester: confirm.detail.requester ?? null, at: confirm.receivedAt } : null,
    messages: rows.filter((r) => r.kind !== "forward_confirm"),
    working: rows.some((r) => r.kind === "mailback" && r.status === "imported"),
  };
});

export const saveMailbackPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ password: z.string().trim().min(1, "Enter the password.").max(100) }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    const pc = await cryptoFor(m.practiceId);
    await db()
      .update(practices)
      .set({ mailbackPasswordEnc: await pc.encrypt("mailback_password", m.practiceId, data.password) })
      .where(eq(practices.id, m.practiceId));
    await audit(m.practiceId, m.userId, "inbox.password_saved");
    const imported = await retryWaiting(m.practiceId);
    return { ok: true as const, imported };
  });

export const renewInboxAddress = createServerFn({ method: "POST" }).handler(async () => {
  const m = await requireMember(["owner"]);
  await ensureInboxCode(m.practiceId, true);
  await audit(m.practiceId, m.userId, "inbox.address_renewed");
  return { ok: true as const };
});

export const retryInboxMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    // Row-level security: the message must be this practice's.
    const [mine] = await withPractice(scopeOf(m), (tx) => tx.select({ id: inboxMessages.id }).from(inboxMessages).where(eq(inboxMessages.id, data.id)));
    if (!mine) return { ok: false as const, error: "Not found." };
    const status = await processMessage(m.practiceId, data.id);
    return { ok: true as const, status };
  });

export const deleteInboxMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    await withPractice(scopeOf(m), (tx) => tx.delete(inboxMessages).where(eq(inboxMessages.id, data.id)));
    return { ok: true as const };
  });

/** The signed-in person's own morning-summary email setting. */
export const getBriefingSetting = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  const [r] = await db()
    .select({ on: memberships.briefingEmail })
    .from(memberships)
    .where(and(eq(memberships.practiceId, m.practiceId), eq(memberships.userId, m.userId)));
  return { on: r?.on ?? false, email: m.email, emailWorks: emailWorks() };
});

export const setBriefingSetting = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ on: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    await db()
      .update(memberships)
      .set({ briefingEmail: data.on })
      .where(and(eq(memberships.practiceId, m.practiceId), eq(memberships.userId, m.userId)));
    return { ok: true as const };
  });
