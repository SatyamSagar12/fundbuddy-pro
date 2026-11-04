/**
 * The public home page: what Folio does, prices, the phone app. Signed-in people go straight to the app.
 * This and /get-app, /login and /signup are the only pages search engines may list (see robots.txt).
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, BellRing, FileText, Inbox, Repeat, ShieldCheck, Smartphone, Users, Wallet } from "lucide-react";
import { getMe } from "@/functions/auth";
import { BrandMark } from "@/components/brand";
import { linkButton, linkButtonSecondary, order } from "@/components/ui";
import { PLANS, PLAN_IDS, TRIAL } from "@/lib/plans";

const SITE = "https://folio.anqulas.com";
const DESCRIPTION =
  "Anqulas Folio is the back office for Indian mutual fund distributors: CAMS and KFintech mailbacks imported automatically, daily NAV valuation with XIRR, SIP bounce alerts, capital gains, client portfolio PDFs and a client app. From ₹499 a month.";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const me = await getMe();
    if (me?.mfaPassed) throw redirect({ to: "/app" });
  },
  head: () => ({
    meta: [
      { title: "Anqulas Folio · Back office software for mutual fund distributors (MFDs)" },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Anqulas Folio · Back office for mutual fund distributors" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: SITE },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${SITE}/icons/icon-512.png` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Anqulas Folio",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web, Android, iOS",
          description: DESCRIPTION,
          url: SITE,
          offers: { "@type": "Offer", price: String(PLANS.starter.inr[1]), priceCurrency: "INR" },
        }),
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Inbox, title: "Mailbacks import themselves", text: "Forward CAMS and KFintech mailbacks once. Every day's transactions arrive and import on their own: no uploads." },
  { icon: Wallet, title: "Valued every evening", text: "Every scheme's NAV from AMFI daily. Current value, gain and XIRR for each client, family and your whole book." },
  { icon: Repeat, title: "SIP book that watches itself", text: "SIPs found from registrar data: active, bounced, missed or stopped, with next dates and monthly SIP inflow." },
  { icon: BellRing, title: "Who to call today", text: "Bounced SIPs, big redemptions and birthdays every morning, with one-tap Call and WhatsApp. Also by email at 8 am." },
  { icon: FileText, title: "Statements and capital gains", text: "Branded portfolio PDFs to share on WhatsApp, and capital gains per financial year with grandfathering." },
  { icon: Users, title: "Families, team and client portal", text: "Group families, add staff and sub-brokers (each sees only their clients), and give clients a read-only login." },
];

function Landing() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-[16px] font-semibold tracking-[-0.02em]">Anqulas Folio</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/login" className="rounded-full px-4 py-2 text-[15px] font-medium text-muted hover:text-text">
            Sign in
          </Link>
          <Link to="/signup" className={linkButton}>
            Start free
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-8 sm:pt-16">
          <p className="eyebrow reveal text-bronze">For mutual fund distributors in India</p>
          <h1 className="text-display mt-4 max-w-4xl text-[clamp(2.5rem,6vw,5.25rem)]">
            <span className="line-mask">
              <span>Your whole MF book,</span>
            </span>
            <span className="line-mask" style={order(1)}>
              <span>
                <em className="text-bronze">updated</em> while you sleep.
              </span>
            </span>
          </h1>
          <p className="reveal mt-6 max-w-2xl text-[17px] leading-relaxed text-muted" style={order(2)}>
            Anqulas Folio is back office software for MFDs. CAMS and KFintech mailbacks import automatically, every
            holding is valued at the latest NAV, and each morning you see whose SIP bounced and who to call. Simple
            enough to use without training.
          </p>
          <div className="reveal mt-8 flex flex-wrap gap-3" style={order(3)}>
            <Link to="/signup" className={linkButton}>
              Start your {TRIAL.days}-day free trial <ArrowRight size={17} aria-hidden />
            </Link>
            <Link to="/get-app" className={linkButtonSecondary}>
              <Smartphone size={17} aria-hidden /> Get the FundVault app
            </Link>
          </div>
          <p className="reveal mt-3 text-[13px] text-muted" style={order(4)}>
            No card needed. Bring your clients from a CAS statement, registrar files or a spreadsheet.
          </p>
        </section>

        <section aria-labelledby="features" className="border-y border-line bg-card/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
            <h2 id="features" className="text-[2rem] sm:text-[2.5rem]">
              Everything an MFD needs, nothing they don't
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <div key={f.title} className="reveal rounded-2xl bg-card p-6 ring-1 ring-line" style={order(i)}>
                  <f.icon size={22} className="text-bronze" aria-hidden />
                  <h3 className="mt-4 text-[17px] font-semibold">{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
          <h2 id="how" className="text-[2rem] sm:text-[2.5rem]">
            Set up once, then it runs itself
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ["Add your clients", "Upload a client's CAS, your CAMS/KFintech reports, or the spreadsheet you use today."],
              ["Forward your mailbacks", "One Gmail filter sends CAMS and KFintech mailbacks to your private Folio address."],
              ["Open it each morning", "Values, SIP status and today's calls are ready. Share statements on WhatsApp in one tap."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-2xl p-6 ring-1 ring-line">
                <span className="font-serif text-[2rem] text-bronze">{i + 1}</span>
                <h3 className="mt-2 text-[17px] font-semibold">{t}</h3>
                <p className="mt-2 text-[15px] text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="pricing" className="border-t border-line bg-card/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
            <h2 id="pricing" className="text-[2rem] sm:text-[2.5rem]">
              Simple prices
            </h2>
            <p className="mt-2 text-muted">Every plan has every feature. Pay for 12 months and get 2 free. {TRIAL.days} days free to start.</p>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {PLAN_IDS.map((id) => {
                const p = PLANS[id];
                return (
                  <div key={id} className="rounded-2xl bg-card p-6 ring-1 ring-line">
                    <h3 className="text-[17px] font-semibold">{p.name}</h3>
                    <p className="mt-3 font-serif text-[2.5rem] leading-none">
                      ₹{p.inr[1].toLocaleString("en-IN")}
                      <span className="text-[15px] text-muted"> / month</span>
                    </p>
                    <ul className="mt-4 space-y-1 text-[15px] text-muted">
                      <li>{p.clients === null ? "Unlimited clients" : `Up to ${p.clients.toLocaleString("en-IN")} clients`}</li>
                      <li>{p.users === 1 ? "1 user" : `Up to ${p.users} team members`}</li>
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby="trust" className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
          <div className="flex flex-wrap items-start gap-4">
            <ShieldCheck size={28} className="text-bronze" aria-hidden />
            <div className="max-w-3xl">
              <h2 id="trust" className="text-[1.75rem]">
                Your clients' data stays yours
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Data is stored in India. PAN, bank and nominee details are encrypted with a key for your practice alone,
                and the database itself keeps each practice apart. Folio never asks for your Gmail password: only
                registrar mailbacks you forward are read.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-muted sm:px-8">
          <p>© {new Date().getFullYear()} Anqulas. Mutual fund investments are subject to market risks; read all scheme related documents carefully.</p>
          <nav className="flex gap-4">
            <Link to="/get-app">Phone app</Link>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Sign up</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
