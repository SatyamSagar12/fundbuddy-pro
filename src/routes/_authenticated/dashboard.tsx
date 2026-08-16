import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Wallet, Repeat, IndianRupee } from "lucide-react";
import { clientsQuery, investmentsQuery, sipsQuery } from "@/lib/data";
import { inr, formatDate } from "@/lib/fundvault";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FundVault Lite" },
      { name: "description", content: "Overview of clients, investments, active SIPs and total amount invested." },
      { property: "og:title", content: "Dashboard — FundVault Lite" },
      { property: "og:description", content: "Advisor dashboard summary for mutual fund clients and SIPs." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const clients = useQuery(clientsQuery);
  const investments = useQuery(investmentsQuery);
  const sips = useQuery(sipsQuery);

  const total = (investments.data ?? []).reduce((sum, i) => sum + Number(i.amount), 0);
  const activeSips = (sips.data ?? []).filter((s) => s.status === "Active").length;
  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "—";

  const stats = [
    { label: "Total Clients", value: String(clients.data?.length ?? 0), icon: Users },
    { label: "Total Investments", value: String(investments.data?.length ?? 0), icon: Wallet },
    { label: "Active SIPs", value: String(activeSips), icon: Repeat },
    { label: "Total Invested", value: inr(total), icon: IndianRupee },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your practice at a glance.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-card">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent transactions</CardTitle>
            <Link to="/investments" className="text-sm font-medium text-primary">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {(investments.data ?? []).slice(0, 5).map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{clientName(i.client_id)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {i.scheme} · {formatDate(i.date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{inr(Number(i.amount))}</p>
                  <Badge variant="secondary" className="text-[10px]">{i.type}</Badge>
                </div>
              </div>
            ))}
            {!investments.data?.length && <EmptyLine text="No data found" />}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">SIP book</CardTitle>
            <Link to="/sips" className="text-sm font-medium text-primary">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {(sips.data ?? []).slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{clientName(s.client_id)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.scheme} · {s.frequency}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{inr(Number(s.amount))}</p>
                  <Badge variant={s.status === "Active" ? "default" : "secondary"} className="text-[10px]">
                    {s.status}
                  </Badge>
                </div>
              </div>
            ))}
            {!sips.data?.length && <EmptyLine text="No data found" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
