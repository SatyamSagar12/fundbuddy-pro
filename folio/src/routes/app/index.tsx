import { createFileRoute, Link } from "@tanstack/react-router";
import { getDashboard } from "@/functions/practice";
import { Card } from "@/components/ui";
import { day, money, txnType } from "@/lib/format";

export const Route = createFileRoute("/app/")({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: "Home · Anqulas Folio" }] }),
  component: HomePage,
});

function HomePage() {
  const d = Route.useLoaderData();
  const { me } = Route.useRouteContext();
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

      {d.clients === 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">Next steps</h2>
          <p className="mt-1 text-muted">
            Automatic import of CAMS and KFintech mailback, daily NAVs and client reports are being built. Your
            clients will appear here once imported.
          </p>
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
