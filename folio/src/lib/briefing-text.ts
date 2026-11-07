/**
 * The morning briefing as plain text: the email today, a WhatsApp message later. Kept short: the first lines say
 * what matters, everything else is one line each.
 */
import { day, shortMoney } from "./format";

export type BriefingText = {
  today: string;
  navDate: string | null;
  value: number;
  dayChange: number | null;
  dayChangePct: number | null;
  sips: {
    active: number;
    bounced: number;
    missed: number;
    endingSoon: number;
    monthly: number;
    bouncedList: { client: string; mobile: string | null; scheme: string; amount: number }[];
    paidRecent: { count: number; amount: number };
    dueWeek: { count: number; amount: number };
  };
  redemptions: { client: string; mobile: string | null; scheme: string; amount: number; date: string }[];
  newMoney: { count: number; amount: number };
  birthdays: { client: string; mobile: string | null; inDays: number; date: string }[];
  unmatched: number;
};

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
const signed = (n: number) => (n >= 0 ? `+${shortMoney(n)}` : shortMoney(n));
const phone = (m: string | null) => (m ? ` · ${m}` : "");

export function briefingHeadline(b: BriefingText): string {
  const parts = [`Book ${shortMoney(b.value)}`];
  if (b.dayChange !== null && b.dayChange !== 0) {
    parts[0] += ` (${signed(b.dayChange)}${b.dayChangePct !== null ? `, ${b.dayChangePct >= 0 ? "+" : ""}${(b.dayChangePct * 100).toFixed(2)}%` : ""})`;
  }
  if (b.sips.bounced) parts.push(`${b.sips.bounced} SIP${b.sips.bounced > 1 ? "s" : ""} bounced`);
  if (b.redemptions.length) parts.push(`${b.redemptions.length} big redemption${b.redemptions.length > 1 ? "s" : ""}`);
  if (b.birthdays.some((x) => x.inDays === 0)) parts.push("birthdays today");
  return parts.join(" · ");
}

export function briefingText(b: BriefingText, opts: { name: string; appUrl: string }): { subject: string; text: string } {
  const lines: string[] = [];
  lines.push(`Good morning, ${opts.name.split(" ")[0]}. Your book on ${weekday(b.today)} ${day(b.today)}:`);
  lines.push("");
  let book = `Book value ${shortMoney(b.value)}`;
  if (b.dayChange !== null) book += `, ${signed(b.dayChange)} since the previous NAV`;
  if (b.navDate) book += ` (NAV of ${day(b.navDate)})`;
  lines.push(book);
  lines.push(`SIPs ${b.sips.active + b.sips.bounced} running, ${shortMoney(b.sips.monthly)} a month`);

  const call: string[] = [];
  for (const s of b.sips.bouncedList) call.push(`- SIP bounced: ${s.client}, ${shortMoney(s.amount)} in ${s.scheme}${phone(s.mobile)}`);
  for (const r of b.redemptions) call.push(`- Redeemed ${shortMoney(r.amount)}: ${r.client}, ${r.scheme} on ${day(r.date)}${phone(r.mobile)}`);
  for (const x of b.birthdays.filter((x) => x.inDays === 0)) call.push(`- Birthday today: ${x.client}${phone(x.mobile)}`);
  if (call.length) {
    lines.push("", "Call today", ...call);
  }

  const week: string[] = [];
  if (b.sips.paidRecent.count) week.push(`- ${b.sips.paidRecent.count} SIP instalments went through (${shortMoney(b.sips.paidRecent.amount)}) in the last 7 days`);
  if (b.sips.dueWeek.count) week.push(`- ${b.sips.dueWeek.count} SIPs due in the next 7 days (${shortMoney(b.sips.dueWeek.amount)})`);
  if (b.newMoney.count) week.push(`- ${b.newMoney.count} one-time investment${b.newMoney.count > 1 ? "s" : ""} (${shortMoney(b.newMoney.amount)}) in the last 7 days`);
  if (b.sips.missed) week.push(`- ${b.sips.missed} SIP${b.sips.missed > 1 ? "s" : ""} missed an instalment`);
  if (b.sips.endingSoon) week.push(`- ${b.sips.endingSoon} SIP${b.sips.endingSoon > 1 ? "s" : ""} end within 45 days: a good time to renew`);
  const later = b.birthdays.filter((x) => x.inDays > 0);
  if (later.length) week.push(`- Birthdays this week: ${later.map((x) => `${x.client} (${weekday(x.date)})`).join(", ")}`);
  if (b.unmatched) week.push(`- ${b.unmatched} scheme name${b.unmatched > 1 ? "s" : ""} to match, so their value can be shown`);
  if (week.length) lines.push("", "This week", ...week);

  lines.push("", `Open Anqulas Folio: ${opts.appUrl}/app`, "", `To stop this email: ${opts.appUrl}/app/settings (Morning summary).`);
  return { subject: `Folio: ${briefingHeadline(b)}`, text: lines.join("\n") };
}
