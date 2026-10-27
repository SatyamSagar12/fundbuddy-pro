import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { addSample, getDashboard, removeSample } from "@/functions/practice";
import { Button, Card, linkButtonSecondary } from "@/components/ui";
import { day, money, txnType } from "@/lib/format";

export const Route = createFileRoute("/app/")({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: "Home · Anqulas Folio" }] }),
  component: HomePage,
});

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
  const stats = [
    { label: "Clients", value: String(d.clients) },
    { label: "Active SIPs", value: String(d.activeSips) },
    { label: "SIP inflow / month", value: money(d.monthlySip) },
    { label: "Invested (recorded)", value: money(d.invested) },
  ];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Good to see you, {me.name.split(" ")[0]}</h1>
        <p className="text-muted">Your practice at a glance.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="!p-5">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{s.label}</p>
            <p className="mt-1 text-[24px] font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      {!me.totpEnabled && (
        <Card className="flex flex-wrap items-center justify-between gap-3 !py-4">
          <p className="text-[15px]">
            <b>Recommended:</b> add a code from your phone to your sign-in, so a leaked password alone can't open your
            clients' data.
          </p>
          <Link to="/app/settings/security" className="font-semibold whitespace-nowrap text-bronze underline">
            Set it up
          </Link>
        </Card>
      )}

      {d.hasSample && (
        <Card className="flex flex-wrap items-center justify-between gap-3 !py-4">
          <p className="text-[15px]">
            <b>Sample data is in your account</b> (8 made-up clients). Remove it when you're ready to add real clients.
          </p>
          {d.canRemoveSample && (
            <Button variant="secondary" disabled={busy} onClick={() => void sample("remove")}>
              {busy ? "Removing…" : "Remove sample data"}
            </Button>
          )}
        </Card>
      )}

      {d.clients === 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">Get started</h2>
          <p className="mt-1 text-muted">Add your first client, or fill the app with sample data to see how everything works.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/app/clients/new" className={linkButtonSecondary}>
              Add a client
            </Link>
            <Button disabled={busy} onClick={() => void sample("add")}>
              {busy ? "Adding…" : "Add sample data"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent transactions</h2>
            <Link to="/app/clients" className="text-[15px] font-semibold text-bronze">
              All clients
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {d.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.client}</p>
                  <p className="truncate text-sm text-muted">
                    {r.scheme ?? "—"} · {day(r.date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(r.amount)}</p>
                  <p className="text-sm text-muted">{txnType(r.type)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
