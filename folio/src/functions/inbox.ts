/** Email import settings (forwarding address, mailback ZIP password, received emails) and the morning summary. */
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { inboxMessages, memberships, practices } from "@/server/db/schema";
import { cryptoFor, requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { ensureInboxCode, inboundDomain, issueGmailToken, processMessage, waitingIds, type InboxDetail } from "@/server/inbox";
import { gmailHelperScript } from "@/lib/gmail-helper-script";
import { appUrl } from "@/server/env";
import { emailWorks } from "@/server/mailer";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  const domain = inboundDomain();
  const code = domain ? await ensureInboxCode(m.practiceId) : null;
  const [p] = await db()
    .select({ cams: practices.mailbackPasswordEnc, kfin: practices.kfintechPasswordEnc, gmail: practices.gmailTokenHash })
    .from(practices)
    .where(eq(practices.id, m.practiceId));
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
  // Any email arriving after Gmail's confirmation means forwarding was confirmed and works.
  const mailbackAfter = confirm && rows.some((r) => r.kind !== "forward_confirm" && r.receivedAt > confirm.receivedAt);
  return {
    address: code && domain ? `${code}@${domain}` : null,
    hasPassword: { cams: Boolean(p?.cams), kfintech: Boolean(p?.kfin) },
    hasGmailHelper: Boolean(p?.gmail),
    viaHelper: rows.filter((r) => (r.detail as InboxDetail).gmailId).length,
    canRenew: m.role === "owner",
    /** Forwarding confirmed: a registrar email has arrived since Gmail's confirmation (or at all). */
    forwarding: Boolean(mailbackAfter) || rows.some((r) => r.kind !== "forward_confirm"),
    confirmation: confirm && !mailbackAfter ? { code: confirm.detail.code ?? null, link: confirm.detail.link ?? null, requester: confirm.detail.requester ?? null, at: confirm.receivedAt } : null,
    messages: rows.filter((r) => r.kind !== "forward_confirm"),
    working: rows.some((r) => r.kind === "mailback" && r.status === "imported"),
  };
});

export const saveMailbackPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ registrar: z.enum(["cams", "kfintech"]), password: z.string().trim().min(1, "Enter the password.").max(100) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    const pc = await cryptoFor(m.practiceId);
    await db()
      .update(practices)
      .set(
        data.registrar === "cams"
          ? { mailbackPasswordEnc: await pc.encrypt("mailback_password", m.practiceId, data.password) }
          : { kfintechPasswordEnc: await pc.encrypt("kfintech_password", m.practiceId, data.password) },
      )
      .where(eq(practices.id, m.practiceId));
    await audit(m.practiceId, m.userId, "inbox.password_saved", { meta: { registrar: data.registrar } });
    // The page retries these one per request: all at once runs past Cloudflare's CPU limit and nothing is saved.
    return { ok: true as const, waiting: await waitingIds(m.practiceId) };
  });

export const renewInboxAddress = createServerFn({ method: "POST" }).handler(async () => {
  const m = await requireMember(["owner"]);
  await ensureInboxCode(m.practiceId, true);
  await audit(m.practiceId, m.userId, "inbox.address_renewed");
  return { ok: true as const };
});

export const retryInboxMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid(), password: z.string().trim().min(1).max(100).optional() }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    // Row-level security: the message must be this practice's.
    const [mine] = await withPractice(scopeOf(m), (tx) => tx.select({ id: inboxMessages.id }).from(inboxMessages).where(eq(inboxMessages.id, data.id)));
    if (!mine) return { ok: false as const, error: "Not found." };
    const status = await processMessage(m.practiceId, data.id, undefined, data.password);
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

/** A fresh Gmail helper script for this practice (a new key: any older script stops working). */
export const createGmailHelper = createServerFn({ method: "POST" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  const token = await issueGmailToken(m.practiceId);
  await audit(m.practiceId, m.userId, "inbox.gmail_helper_created");
  return { script: gmailHelperScript(`${appUrl()}/__inbox/gmail`, token) };
});
