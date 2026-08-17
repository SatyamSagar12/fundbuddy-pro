import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, IndianRupee, Repeat, TrendingUp, Wallet } from "lucide-react";
import { clientsQuery, investmentsQuery, sipsQuery } from "@/lib/data";
import {
  downloadCsv,
  financialYear,
  formatDate,
  inr,
  monthlyBreakdown,
  monthlySipCommitment,
  topSchemes,
  yearlyBreakdown,
} from "@/lib/fundvault";
import {
  MonthlyFlowChart,
  SchemeMixChart,
  SipTrendChart,
  YearlyTotalsChart,
} from "@/components/app/ReportCharts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — FundVault Lite" },
      {
        name: "description",
        content:
          "Monthly SIP and one-time investment trends, yearly totals and scheme mix, with CSV export.",
      },
      { property: "og:title", content: "Reports — FundVault Lite" },
      {
        property: "og:description",
        content: "Visual mutual fund reports: monthly SIP flow, yearly totals and scheme mix.",
      },
    ],
  }),
  component: ReportsPage,
});

const ALL_CLIENTS = "all";
const RANGES = [
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
] as const;

function ReportsPage() {
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: investments = [] } = useQuery(investmentsQuery);
  const { data: sips = [] } = useQuery(sipsQuery);

  // One filter row scopes every chart below — never per-chart filters.
  const [clientId, setClientId] = useState<string>(ALL_CLIENTS);
  const [months, setMonths] = useState<string>("12");

  const scopedInvestments = useMemo(
    () =>
      clientId === ALL_CLIENTS ? investments : investments.filter((i) => i.client_id === clientId),
    [investments, clientId],
  );
  const scopedSips = useMemo(
    () => (clientId === ALL_CLIENTS ? sips : sips.filter((s) => s.client_id === clientId)),
    [sips, clientId],
  );

  const monthly = useMemo(
    () => monthlyBreakdown(scopedInvestments, Number(months)),
    [scopedInvestments, months],
  );
  const yearly = useMemo(() => yearlyBreakdown(scopedInvestments), [scopedInvestments]);
  const schemes = useMemo(() => topSchemes(scopedInvestments), [scopedInvestments]);

  const client = clients.find((c) => c.id === clientId);
  const scopeLabel = client ? client.name : "All clients";

  const periodTotal = monthly.reduce((sum, m) => sum + m.total, 0);
  const periodSip = monthly.reduce((sum, m) => sum + m.sip, 0);
  const activeMonths = monthly.filter((m) => m.total > 0).length;
  const monthlyCommitment = monthlySipCommitment(scopedSips);
  const currentFy = yearly.find((y) => y.year === financialYear(new Date()));

  const kpis = [
    {
      label: `Invested · last ${months} months`,
      value: inr(periodTotal),
      hint: `${activeMonths} active ${activeMonths === 1 ? "month" : "months"}`,
      icon: IndianRupee,
    },
    {
      label: "Monthly SIP commitment",
      value: inr(monthlyCommitment),
      hint: `${scopedSips.filter((s) => s.status === "Active").length} active SIPs`,
      icon: Repeat,
    },
    {
      label: "SIP share of inflow",
      value: periodTotal ? `${Math.round((periodSip / periodTotal) * 100)}%` : "—",
      hint: `${inr(periodSip)} via SIP`,
      icon: TrendingUp,
    },
    {
      label: `${financialYear(new Date())} total`,
      value: inr(currentFy?.total ?? 0),
      hint: `${currentFy?.count ?? 0} transactions`,
      icon: Wallet,
    },
  ];

  function exportCsv() {
    const name = client ? client.name.replace(/\s+/g, "-").toLowerCase() : "all-clients";
    downloadCsv(
      `${name}-monthly-report.csv`,
      monthly.map((m) => ({
        Month: m.label,
        SIP: m.sip,
        OneTime: m.oneTime,
        Total: m.total,
      })),
    );
  }

  function exportYearlyCsv() {
    const name = client ? client.name.replace(/\s+/g, "-").toLowerCase() : "all-clients";
    downloadCsv(
      `${name}-yearly-report.csv`,
      yearly.map((y) => ({
        FinancialYear: y.year,
        SIP: y.sip,
        OneTime: y.oneTime,
        Total: y.total,
        Transactions: y.count,
      })),
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monthly SIP and one-time flow, yearly totals and scheme mix for {scopeLabel}.
        </p>
      </header>

      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="min-w-52 flex-1 space-y-2">
            <Label htmlFor="report-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="report-client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CLIENTS}>All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44 space-y-2">
            <Label htmlFor="report-range">Period</Label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger id="report-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!scopedInvestments.length}>
            <Download className="mr-2 h-4 w-4" /> Monthly CSV
          </Button>
          <Button variant="outline" onClick={exportYearlyCsv} disabled={!yearly.length}>
            <Download className="mr-2 h-4 w-4" /> Yearly CSV
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="shadow-card">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <k.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="truncate text-xl font-semibold">{k.value}</p>
                <p className="truncate text-xs text-muted-foreground">{k.hint}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts and their table twin — every value stays reachable without hover. */}
      <Tabs defaultValue="charts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="table">Table view</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Monthly investment flow</CardTitle>
                <CardDescription>
                  SIP and one-time investments per month, last {months} months.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MonthlyFlowChart data={monthly} />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Monthly SIP trend</CardTitle>
                <CardDescription>SIP inflow per month, peak month labelled.</CardDescription>
              </CardHeader>
              <CardContent>
                <SipTrendChart data={monthly} />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Yearly totals</CardTitle>
                <CardDescription>
                  Total invested per Indian financial year (April–March).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <YearlyTotalsChart data={yearly} />
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Scheme mix</CardTitle>
                <CardDescription>Top schemes by amount invested.</CardDescription>
              </CardHeader>
              <CardContent>
                <SchemeMixChart data={schemes} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="table" className="space-y-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Monthly breakdown</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">SIP</TableHead>
                    <TableHead className="text-right">One-time</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthly.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>{m.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(m.sip)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(m.oneTime)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inr(m.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Yearly breakdown</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Financial year</TableHead>
                    <TableHead className="text-right">SIP</TableHead>
                    <TableHead className="text-right">One-time</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yearly.map((y) => (
                    <TableRow key={y.year}>
                      <TableCell>{y.year}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(y.sip)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(y.oneTime)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {inr(y.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{y.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!yearly.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">No data found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {client && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">{client.name} · transactions</CardTitle>
            <CardDescription>All recorded investments for this client.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scheme</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scopedInvestments.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.scheme}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {i.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {inr(Number(i.amount))}
                    </TableCell>
                    <TableCell>{formatDate(i.date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!scopedInvestments.length && (
              <p className="py-8 text-center text-sm text-muted-foreground">No data found</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
