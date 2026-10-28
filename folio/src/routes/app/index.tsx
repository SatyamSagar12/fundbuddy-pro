import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, MessageCircle, Phone, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { addSample, getDashboard, removeSample } from "@/functions/practice";
import { Button, Card, EmptyState, linkButton, linkButtonSecondary, order } from "@/components/ui";
import { ClientAvatar } from "@/components/client-avatar";
import { CountUp } from "@/components/motion";
import { day, money, percent, txnType } from "@/lib/format";
import { shownReturn } from "@/lib/holdings";

export const Route = createFileRoute("/app/")({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: "Home · Anqulas Folio" }] }),
  component: HomePage,
});

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const formatMoney = (n: number) => money(n);
const formatCount = (n: number) => String(Math.round(n));

function HomePage() {
  const d = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function sample(action: "add" | "remove") {
    if (action === "remove" && !confirm("Remove the 8 sample clients and their SIPs and investments? Your real clients stay.")) return;
    setBusy(true);
    try {
      await (action === "add" ? addSample() : removeSample());
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }
  const authCallout = !me.totpEnabled && (
    <Callout i={3} action={<Link to="/app/settings/security" className="link-draw font-medium whitespace-nowrap text-bronze">Set it up</Link>}>
      <b className="font-semibold">Recommended:</b> add a code from your phone to your sign-in, so a leaked password alone
      can't open your clients' data.
    </Callout>
  );
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="reveal text-[13px] text-muted">{today}</p>
          <h1 className="mt-1.5 text-[2.125rem] sm:text-[2.625rem]">
            <span className="line-mask">
              <span>{`${greeting()}, ${me.name.split(" ")[0]}`}</span>
            </span>
          </h1>
        </div>
        <div className="reveal flex flex-wrap gap-2" style={order(1)}>
          <Link to="/app/clients" className={linkButtonSecondary}>
            All clients
          </Link>
          <Link to="/app/investments" search={{ add: true }} className={linkButton}>
            <Plus size={17} /> Add investment
          </Link>
        </div>
      </header>

      {d.clients === 0 ? (
        <div className="reveal" style={order(2)}>
          <EmptyState
            title="Start with your clients"
            description="Add your first client, or fill the app with 8 made-up clients to see every screen at work. Sample data is removed in one click."
            action={
              <>
                <Link to="/app/clients/new" className={linkButtonSecondary}>
                  Add a client
                </Link>
                <Button disabled={busy} onClick={() => void sample("add")}>
                  {busy ? "Adding…" : "Add sample data"}
                </Button>
              </>
            }
          />
        </div>
      ) : null}
      {d.clients === 0 && authCallout}
      {d.clients > 0 && (
        <>
          <section aria-label="Summary" className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <ValueHero total={d.total} dayChange={d.briefing.dayChange} dayChangePct={d.briefing.dayChangePct} />
            <div
              className="reveal grid overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgb(30_41_35/0.18)] ring-1 ring-line lg:grid-rows-3"
              style={order(2)}
            >
              <MetricRow
                to="/app/sips"
                label="SIP inflow a month"
                value={d.monthlySip}
                format={formatMoney}
                detail={`${d.activeSips} running SIP${d.activeSips === 1 ? "" : "s"}`}
                meter={<Segments filled={Math.min(d.activeSips, 10)} total={10} className="bg-good" />}
              />
              <MetricRow
                to="/app/clients"
                label="Clients"
                value={d.clients}
                format={formatCount}
                detail={`${money(d.invested)} invested, as recorded`}
                meter={<Segments filled={Math.min(Math.ceil(d.clients / 10), 10)} total={10} className="bg-bronze" />}
              />
              <MetricRow
                to="/app/schemes"
                label="Schemes to match"
                value={d.unmatched}
                format={formatCount}
                detail={d.unmatched ? "Not valued until matched to AMFI" : "Every scheme is valued"}
                meter={<Segments filled={Math.min(d.unmatched, 10)} total={10} className="bg-warn" fade />}
              />
            </div>
          </section>

          <TodayList b={d.briefing} advisor={me.name} />

          {authCallout}

          {d.hasSample && (
            <Callout
              i={4}
              action={
                d.canRemoveSample && (
                  <Button variant="secondary" disabled={busy} onClick={() => void sample("remove")}>
                    {busy ? "Removing…" : "Remove sample data"}
                  </Button>
                )
              }
            >
              <b className="font-semibold">Sample data is in your account</b> (8 made-up clients). Remove it when you're ready
              to add real clients.
            </Callout>
          )}

          <section aria-label="Recent transactions" className="reveal overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-line" style={order(5)}>
            <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3 sm:px-6">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Recent transactions</h2>
              <Link to="/app/investments" className="link-draw text-[13px] font-medium text-bronze">
                All investments
              </Link>
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {d.recent.map((r, i) => (
                <li key={r.id} className="ink-sweep reveal flex items-center gap-3.5 px-5 py-3 sm:px-6" style={order(6 + i)}>
                  <ClientAvatar name={r.client} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{r.client}</p>
                    <p className="truncate text-[13px] text-muted">
                      {r.scheme ?? "—"} · {day(r.date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">{money(r.amount)}</p>
                    <p className="text-[13px] text-muted">{txnType(r.type)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

type Total = Awaited<ReturnType<typeof getDashboard>>["total"];

/** The practice's money, valued at the latest NAV: the one figure that matters first. Olive in both themes. */
function ValueHero({ total: t, dayChange, dayChangePct }: { total: Total; dayChange: number | null; dayChangePct: number | null }) {
  const valued = t.value > 0 || t.cost > 0;
  const working = !valued && t.pendingUnits > 0;
  const ret = shownReturn(t);
  const up = t.gain >= 0;
  return (
    <div
      className="reveal relative isolate overflow-hidden rounded-2xl bg-ink px-6 py-6 text-bone shadow-[0_18px_40px_-24px_rgb(30_41_35/0.6)] sm:px-8 sm:py-7 dark:bg-[#243029] dark:ring-1 dark:ring-white/10"
      style={order(1)}
    >
      <span aria-hidden className="pointer-events-none absolute -right-32 -bottom-40 -z-10 size-[26rem] rounded-full bg-[radial-gradient(closest-side,rgb(205_174_126/0.2),transparent)]" />
      <p className="flex items-center gap-2.5 text-[13px] font-medium text-[#a9b0a5]">
        <span className={clsx("size-[7px] rounded-full", valued ? "ping-current bg-[#9fc0a6] text-[#9fc0a6]" : "bg-[#a9b0a5]")} aria-hidden />
        {valued ? "Current value of your clients' money" : "Current value"}
      </p>

      {valued ? (
        <>
          <p className="mt-4 font-serif text-[3.25rem] leading-[0.95] font-medium tracking-[-0.03em] sm:text-[4.25rem]" data-numeric>
            <CountUp value={t.value} format={formatMoney} duration={1200} />
          </p>
          <p className="mt-4 text-[15px] text-[#bdc1b6]">
            {t.navDate ? `At the NAV of ${day(t.navDate)}` : "At the latest NAV"} · {money(t.cost)} invested
          </p>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            <li className={clsx("rounded-full border px-3 py-1 text-[13px]", up ? "border-[#9fc0a6]/30 text-[#bfe0c5]" : "border-[#e3907f]/30 text-[#f0b5a8]")}>
              {up ? "+" : "−"}
              {money(Math.abs(t.gain))} gain
            </li>
            <li className="rounded-full border border-bone/15 px-3 py-1 text-[13px] text-[#d8d2c5]">
              {ret.label} {percent(ret.value)}
            </li>
            {dayChange !== null && dayChange !== 0 && (
              <li
                className={clsx("rounded-full border px-3 py-1 text-[13px]", dayChange > 0 ? "border-[#9fc0a6]/30 text-[#bfe0c5]" : "border-[#e3907f]/30 text-[#f0b5a8]")}
                title="Change since the previous NAV"
              >
                {dayChange > 0 ? "+" : "−"}
                {money(Math.abs(dayChange))} today{dayChangePct !== null ? ` (${dayChangePct > 0 ? "+" : ""}${(dayChangePct * 100).toFixed(2)}%)` : ""}
              </li>
            )}
            {t.pendingUnits > 0 && (
              <li className="rounded-full border border-bone/15 px-3 py-1 text-[13px] text-[#d8d2c5]">{t.pendingUnits} entries waiting for NAVs</li>
            )}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-5 font-serif text-[2.25rem] leading-[1.1] tracking-[-0.01em] sm:text-[2.75rem]">
            {working ? "Working it out…" : "Not valued yet."}
          </p>
          <p className="mt-3 max-w-md text-[15px] text-[#bdc1b6]">
            {working
              ? "NAVs for these schemes are being fetched. Values appear in a minute or two."
              : "Match each scheme name to its AMFI scheme, and the app values every holding at the latest NAV."}
          </p>
        </>
      )}

      <div className="mt-6">
        <Link
          to={valued ? "/app/clients" : "/app/schemes"}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-bone/25 px-5 text-[14px] font-medium transition-colors hover:bg-white/5"
        >
          {valued ? "Value by client" : "Match schemes"} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function MetricRow({
  to,
  label,
  value,
  format,
  detail,
  meter,
}: {
  to: "/app/sips" | "/app/clients" | "/app/schemes";
  label: string;
  value: number;
  format: (n: number) => string;
  detail: string;
  meter: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group/metric grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-5 border-t border-line px-5 py-4 transition-colors duration-200 first:border-t-0 hover:bg-soft/50 sm:px-6"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold tracking-[-0.01em]">{label}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">{detail}</span>
        <span className="mt-2.5 block">{meter}</span>
      </span>
      <span className="font-serif text-[2rem] leading-none tracking-[-0.02em] sm:text-[2.25rem]">
        <CountUp value={value} format={format} />
      </span>
      <ChevronRight size={16} aria-hidden className="text-muted transition-transform duration-200 group-hover/metric:translate-x-0.5 group-hover/metric:text-text" />
    </Link>
  );
}

/** A short row of segments: how full something is, at a glance. */
function Segments({ filled, total, className, fade = false }: { filled: number; total: number; className: string; fade?: boolean }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={clsx("grow-x h-1 w-4 rounded-full", i < filled ? className : "bg-text/10")}
          style={{ animationDelay: `${300 + i * 40}ms`, ...(fade && i < filled ? { opacity: Math.max(0.3, 1 - i * 0.08) } : {}) }}
        />
      ))}
    </span>
  );
}

function Callout({ children, action, i }: { children: ReactNode; action?: ReactNode; i: number }) {
  return (
    <Card className="reveal flex flex-wrap items-center justify-between gap-3 !py-4" style={order(i)}>
      <p className="text-[15px]">{children}</p>
      {action}
    </Card>
  );
}

type BriefingData = Awaited<ReturnType<typeof getDashboard>>["briefing"];

/** Phone number for a WhatsApp link: digits only, Indian numbers get 91 in front. */
function waNumber(mobile: string): string | null {
  const d = mobile.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

function ContactButtons({ mobile, message }: { mobile: string | null; message: string }) {
  if (!mobile) return <span className="text-[13px] text-muted">No mobile saved</span>;
  const wa = waNumber(mobile);
  return (
    <span className="flex shrink-0 gap-1.5">
      <a href={`tel:${mobile.replace(/[^\d+]/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium hover:bg-soft" aria-label="Call">
        <Phone size={14} aria-hidden /> Call
      </a>
      {wa && (
        <a
          href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium hover:bg-soft"
          aria-label="WhatsApp"
        >
          <MessageCircle size={14} aria-hidden /> WhatsApp
        </a>
      )}
    </span>
  );
}

/** Who to call today, and the week's SIP numbers: the morning briefing, on screen. */
function TodayList({ b, advisor }: { b: BriefingData; advisor: string }) {
  const first = (n: string) => n.split(" ")[0] ?? n;
  const me = advisor.split(" ")[0];
  const items: { key: string; client: string; investorId: string; mobile: string | null; title: string; detail: string; tone: string; message: string }[] = [];
  for (const s of b.sips.bouncedList) {
    items.push({
      key: `b-${s.investorId}-${s.scheme}`,
      client: s.client,
      investorId: s.investorId,
      mobile: s.mobile,
      title: "SIP bounced",
      detail: `${money(s.amount)} · ${s.scheme}`,
      tone: "text-bad",
      message: `Namaste ${first(s.client)} ji, your SIP of ${money(s.amount)} in ${s.scheme} did not go through this time: the bank returned it. Please keep the balance ready for the next date, or let me know if you want any change. – ${me}`,
    });
  }
  for (const r of b.redemptions) {
    items.push({
      key: `r-${r.investorId}-${r.date}-${r.amount}`,
      client: r.client,
      investorId: r.investorId,
      mobile: r.mobile,
      title: `Redeemed ${money(r.amount)}`,
      detail: `${r.scheme} · ${day(r.date)}`,
      tone: "text-warn",
      message: `Namaste ${first(r.client)} ji, I saw the redemption of ${money(r.amount)} from ${r.scheme}. Do you have a plan for this money? Happy to help. – ${me}`,
    });
  }
  for (const x of b.birthdays) {
    items.push({
      key: `d-${x.investorId}`,
      client: x.client,
      investorId: x.investorId,
      mobile: x.mobile,
      title: x.inDays === 0 ? "Birthday today" : `Birthday ${new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" })}`,
      detail: "Send wishes",
      tone: "text-bronze",
      message: `Happy birthday, ${first(x.client)} ji! Wishing you good health and happiness in the year ahead. – ${me}`,
    });
  }
  const stats = [
    b.sips.paidRecent.count > 0 && `${b.sips.paidRecent.count} SIP instalments in the last 7 days · ${money(b.sips.paidRecent.amount)}`,
    b.sips.dueWeek.count > 0 && `${b.sips.dueWeek.count} SIPs due this week · ${money(b.sips.dueWeek.amount)}`,
    b.newMoney.count > 0 && `${b.newMoney.count} one-time investment${b.newMoney.count > 1 ? "s" : ""} · ${money(b.newMoney.amount)}`,
    b.sips.missed > 0 && `${b.sips.missed} SIP${b.sips.missed > 1 ? "s" : ""} missed an instalment`,
    b.sips.endingSoon > 0 && `${b.sips.endingSoon} SIP${b.sips.endingSoon > 1 ? "s" : ""} ending soon`,
  ].filter(Boolean) as string[];

  return (
    <section aria-label="Today" className="reveal overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-line" style={order(3)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-4 pb-3 sm:px-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Today</h2>
        <Link to="/app/sips" className="link-draw text-[13px] font-medium text-bronze">
          SIP book
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[15px] text-muted sm:px-6">Nothing needs a call today: no bounced SIPs, big redemptions or birthdays.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((it, i) => (
            <li key={it.key} className="ink-sweep reveal flex flex-wrap items-center gap-3.5 px-5 py-3 sm:px-6" style={order(4 + i)}>
              <ClientAvatar name={it.client} />
              <div className="min-w-[12rem] flex-1">
                <p className="text-[15px] font-medium">
                  <Link to="/app/clients/$clientId" params={{ clientId: it.investorId }} className="hover:underline">
                    {it.client}
                  </Link>{" "}
                  <span className={`text-[13px] font-semibold whitespace-nowrap ${it.tone}`}>· {it.title}</span>
                </p>
                <p className="truncate text-[13px] text-muted">{it.detail}</p>
              </div>
              <span className="w-full pl-[3.125rem] sm:w-auto sm:pl-0">
                <ContactButtons mobile={it.mobile} message={it.message} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {stats.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 border-t border-line px-5 py-3 sm:px-6">
          {stats.map((t) => (
            <li key={t} className="rounded-full bg-soft px-3 py-1 text-[13px] text-muted">
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
