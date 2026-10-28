/**
 * Sends the morning briefing by email, once a day after 8 am India time.
 *
 * Runs from whatever wakes the app first after 8 am: the scheduled tick (folio-mail Worker's cron, see
 * workers/folio-mail) or, failing that, the first page request. A row in market_state claims the day, so only one
 * instance sends.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "./db/client";
import { withPractice } from "./db/scope";
import { memberships, practices, users } from "./db/schema";
import { billingState } from "./billing";
import { buildBriefing, worthSending } from "./briefing";
import { emailWorks, sendMail } from "./mailer";
import { appEnv } from "./env";
import { briefingText } from "@/lib/briefing-text";
import { todayIst } from "@/lib/records";
import { sql } from "drizzle-orm";

const SEND_FROM_HOUR_IST = 8;

function istHour(now = new Date()): number {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours();
}

/** The address used in links when no request is around (cron). */
function linkBase(): string | null {
  const u = appEnv().APP_URL?.trim();
  return u ? u.replace(/\/+$/, "") : null;
}

export async function sendBriefingsIfDue(now = new Date()): Promise<{ sent: number } | null> {
  if (istHour(now) < SEND_FROM_HOUR_IST || !emailWorks()) return null;
  const base = linkBase();
  if (!base) return null;
  const today = todayIst();
  const claimed = await db().execute(sql`
    insert into market_state (key, value, updated_at) values ('briefing_sent', ${today}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where market_state.value is distinct from excluded.value
    returning key`);
  if (![...claimed].length) return null;
  return { sent: await sendBriefings(today, base) };
}

/** One email per active team member who wants it, built with their own view of the clients. */
export async function sendBriefings(today: string, base: string): Promise<number> {
  const rows = await db()
    .select({
      practiceId: practices.id,
      billingExempt: practices.billingExempt,
      plan: practices.plan,
      trialEndsAt: practices.trialEndsAt,
      paidUntil: practices.paidUntil,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(practices, eq(practices.id, memberships.practiceId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.active, true), eq(memberships.briefingEmail, true), eq(practices.status, "active"), isNotNull(users.emailVerifiedAt)),
    );
  let sent = 0;
  for (const r of rows) {
    if (billingState(r).state === "locked") continue;
    try {
      const b = await withPractice({ practiceId: r.practiceId, userId: r.userId, limited: r.role === "subbroker" }, (tx) => buildBriefing(tx, today));
      if (!worthSending(b)) continue;
      const mail = briefingText(b, { name: r.name, appUrl: base });
      if (await sendMail({ to: r.email, ...mail })) sent++;
    } catch (e) {
      console.error(`Briefing for ${r.userId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
