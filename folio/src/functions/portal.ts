/**
 * Client portal: the client's sign-in (email, then an emailed code) and their read-only portfolio; and, for the
 * team, turning the portal on and sending a client the link. Rules are in src/server/portal.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withInvestors, withPractice } from "@/server/db/scope";
import { investors, portalSessions, practices } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { appUrl } from "@/server/env";
import { emailWorks, sendMail } from "@/server/mailer";
import { underLimit } from "@/server/rate-limit";
import { loadStatement } from "@/server/statement";
import {
  checkPortalCode,
  createPortalSession,
  endPortalSession,
  issuePortalCode,
  mayAskForCode,
  mayEnterCode,
  newPortalLinkCode,
  peopleForEmail,
  portalPractice,
  requirePortal,
} from "@/server/portal";
import type { StatementData } from "@/lib/statement";

const linkCode = z.string().trim().toLowerCase().max(16);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email({ message: "Enter a valid email address." }));
const BROKEN_LINK = "This link isn't working. Ask your distributor for a new one.";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ── For clients (no team sign-in) ───────────────────────────────────────────

/** The distributor behind a portal link, for the branded sign-in page. */
export const portalLink = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ code: linkCode }).parse(data))
  .handler(async ({ data }) => {
    const p = await portalPractice(data.code);
    return p ? { name: p.name, arn: p.arn, euin: p.euin } : null;
  });

export const askPortalCode = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ code: linkCode, email }).parse(data))
  .handler(async ({ data }): Promise<Result> => {
    const p = await portalPractice(data.code);
    if (!p) return { ok: false, error: BROKEN_LINK };
    if (!(await mayAskForCode(p.id, data.email))) return { ok: false, error: "Too many codes asked for. Wait 15 minutes and try again." };
    // The same answer whether or not the email is on the records.
    const who = await peopleForEmail(p.id, data.email);
    if (who.ok) {
      const otp = await issuePortalCode(p.id, data.email);
      await sendMail({
        to: data.email,
        subject: `${otp} is your code for ${p.name}`,
        text: `Your code to see your portfolio with ${p.name}: ${otp}\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email.\n\n${p.name}${p.arn ? ` (${p.arn})` : ""}`,
      });
    }
    return { ok: true };
  });

export const enterPortalCode = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ code: linkCode, email, otp: z.string().trim().max(12) }).parse(data))
  .handler(async ({ data }): Promise<Result> => {
    const p = await portalPractice(data.code);
    if (!p) return { ok: false, error: BROKEN_LINK };
    if (!(await mayEnterCode(p.id, data.email))) return { ok: false, error: "Too many tries. Wait 15 minutes and ask for a new code." };
    const result = await checkPortalCode(p.id, data.email, data.otp);
    if (result === "wrong") return { ok: false, error: "That code isn't right. Check the latest email and try again." };
    if (result === "used_up") return { ok: false, error: "This code has expired or was used up. Ask for a new one." };
    const who = await peopleForEmail(p.id, data.email);
    if (!who.ok) return { ok: false, error: "This code has expired or was used up. Ask for a new one." };
    await createPortalSession(p.id, data.email);
    await audit(p.id, null, "portal.signed_in", { meta: { email: data.email, clients: who.investorIds.length } });
    return { ok: true };
  });

/** The practice link of the portal session behind this request, if signed in (so the sign-in page can skip ahead). */
export const portalSignedIn = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requirePortal();
  return s ? { code: s.practice.code } : null;
});

export const portalSignOut = createServerFn({ method: "POST" }).handler(async () => {
  await endPortalSession();
  return { ok: true as const };
});

/** The signed-in client's portfolio (their family's, if they're in one), read in their own portal scope. */
export const getPortalHome = createServerFn({ method: "GET" }).handler(async (): Promise<(StatementData & { email: string; code: string | null }) | null> => {
  const s = await requirePortal();
  if (!s) return null;
  const isFamily = s.familyName !== null;
  const body = await withInvestors(s.scope, (tx) => loadStatement(tx, s.people, s.familyName ?? s.people[0]!.name, isFamily));
  return { ...body, practice: { name: s.practice.name, arn: s.practice.arn, euin: s.practice.euin }, email: s.email, code: s.practice.code };
});

// ── For the team ────────────────────────────────────────────────────────────

export const getPortalSettings = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  const [p] = await db().select({ enabled: practices.portalEnabled, code: practices.portalCode }).from(practices).where(eq(practices.id, m.practiceId));
  const stats = await withPractice(scopeOf(m), async (tx) => {
    const [n] = await tx.select({ withEmail: sql<number>`count(*) filter (where ${investors.email} is not null)::int`, all: sql<number>`count(*)::int` }).from(investors);
    // An email on clients of different families (or several clients without one) can't sign in: list them to fix.
    const shared = await tx.execute<{ email: string; names: string }>(sql`
      select lower(${investors.email}) as email, string_agg(${investors.name}, ', ' order by ${investors.name}) as names
      from ${investors} where ${investors.email} is not null and ${investors.email} <> ''
      group by lower(${investors.email})
      having count(distinct coalesce(${investors.familyId}::text, 'self:' || ${investors.id}::text)) > 1
      order by 1 limit 50`);
    return { withEmail: n?.withEmail ?? 0, all: n?.all ?? 0, shared: [...shared] };
  });
  return {
    enabled: p?.enabled ?? false,
    link: p?.code ? `${appUrl()}/c/${p.code}` : null,
    emailWorks: emailWorks(),
    canEdit: m.role === "owner",
    ...stats,
  };
});

export const setPortalEnabled = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    const [p] = await db().select({ code: practices.portalCode }).from(practices).where(eq(practices.id, m.practiceId));
    let code = p?.code ?? null;
    for (let i = 0; !code && i < 5; i++) {
      const next = newPortalLinkCode();
      const taken = await db().select({ id: practices.id }).from(practices).where(eq(practices.portalCode, next));
      if (!taken.length) code = next;
    }
    await db().update(practices).set({ portalEnabled: data.enabled, portalCode: code }).where(eq(practices.id, m.practiceId));
    // Turning it off signs every client out at once.
    if (!data.enabled) await db().delete(portalSessions).where(eq(portalSessions.practiceId, m.practiceId));
    await audit(m.practiceId, m.userId, data.enabled ? "portal.enabled" : "portal.disabled");
    return { ok: true as const };
  });

/** Whether the portal is on, for any team member (a client's page offers to email the link). */
export const portalOn = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  const [p] = await db().select({ enabled: practices.portalEnabled }).from(practices).where(eq(practices.id, m.practiceId));
  return { enabled: p?.enabled ?? false, canManage: m.role !== "subbroker" };
});

/** Emails a client the portal link (it's also fine to share the link on WhatsApp). */
export const sendPortalLink = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ investorId: z.uuid() }).parse(data))
  .handler(async ({ data }): Promise<Result<{ to: string }>> => {
    const m = await requireMember();
    const [p] = await db().select({ name: practices.name, enabled: practices.portalEnabled, code: practices.portalCode }).from(practices).where(eq(practices.id, m.practiceId));
    if (!p?.enabled || !p.code) return { ok: false, error: "Turn on the client portal first." };
    const c = await withPractice(scopeOf(m), async (tx) => {
      const [row] = await tx.select({ name: investors.name, email: investors.email }).from(investors).where(eq(investors.id, data.investorId));
      return row ?? null;
    });
    if (!c) return { ok: false, error: "Client not found." };
    if (!c.email) return { ok: false, error: "Add the client's email first." };
    const who = await peopleForEmail(m.practiceId, c.email);
    if (!who.ok) return { ok: false, error: "This email is also on clients of another family. Fix the emails first (Client portal page)." };
    if (!(await underLimit(`portal:invite:${m.practiceId}`, 100, 3600))) return { ok: false, error: "Too many emails this hour. Try again later." };
    await sendMail({
      to: c.email,
      subject: `Your portfolio with ${p.name}`,
      text: `Hello ${c.name},\n\nYou can now see your${who.investorIds.length > 1 ? " family's" : ""} mutual fund portfolio with ${p.name} at any time:\n${appUrl()}/c/${p.code}\n\nSign in with this email address (${c.email}); we'll send you a code each time. Nobody else can see it.\n\n${p.name}`,
    });
    await audit(m.practiceId, m.userId, "portal.link_sent", { target: data.investorId });
    return { ok: true, to: c.email };
  });
