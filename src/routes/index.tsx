import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Users, Repeat, FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FundVault Lite — Mutual Fund Management System" },
      {
        name: "description",
        content:
          "FundVault Lite helps financial advisors manage mutual fund clients, investments, SIPs and reports in one lightweight dashboard.",
      },
      { property: "og:title", content: "FundVault Lite — Mutual Fund Management System" },
      {
        property: "og:description",
        content: "Manage clients, investments, SIPs and reports in one simple advisor dashboard.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Users, title: "Client master", text: "Contact, PAN, address and nominee details in one record." },
  { icon: ShieldCheck, title: "Investment book", text: "Log one-time and SIP transactions with payment references." },
  { icon: Repeat, title: "SIP tracking", text: "Monitor monthly and quarterly plans, active or paused." },
  { icon: FileBarChart, title: "Reports", text: "Client-wise summaries with one-click CSV export." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-brand text-brand-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            FV
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold">FundVault Lite</p>
            <p className="text-[11px] opacity-60">Mutual Fund Management System</p>
          </div>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-primary">For financial advisors</p>
        <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
          Every client, investment and SIP in one clean dashboard
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base opacity-70">
          FundVault Lite is a lightweight mutual fund management system — add clients with nominee details, record
          investments, track SIPs and export reports.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Open the dashboard</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-6">
            <f.icon className="h-5 w-5 text-primary" />
            <h2 className="mt-4 text-base font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm opacity-70">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
