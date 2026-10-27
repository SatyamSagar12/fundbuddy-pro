import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { getReportData } from "@/functions/ledger";
import { Button, Card, PageHeader, SelectField } from "@/components/ui";
import { MonthlyFlowChart, SchemeMixChart, SipTrendChart, YearlyTotalsChart } from "@/components/report-charts";
import { financialYear, monthlyBreakdown, monthlySipCommitment, topSchemes, yearlyBreakdown } from "@/lib/report-math";
import { money } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/app/reports")({
  validateSearch: z.object({ client: z.string().optional(), months: z.enum(["6", "12", "24"]).optional() }),
  loaderDeps: ({ search }) => ({ client: search.client }),
  loader: ({ deps }) => getReportData({ data: { client: deps.client } }),
  head: () => ({ meta: [{ title: "Reports · Anqulas Folio" }] }),
  component: ReportsPage,
});

const RANGES = [
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
] as const;

function ReportsPage() {
  const d = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const months = Number(search.months ?? "12");
  const [view, setView] = useState<"charts" | "table">("charts");

  const monthly = useMemo(() => monthlyBreakdown(d.entries, months), [d.entries, months]);
  const yearly = useMemo(() => yearlyBreakdown(d.entries), [d.entries]);
  const schemes = useMemo(() => topSchemes(d.entries), [d.entries]);
  const client = d.clients.find((c) => c.id === search.client);
  const scope = client?.name ?? "All clients";
  const fileName = (client?.name ?? "all-clients").replace(/\s+/g, "-").toLowerCase();

  const periodTotal = monthly.reduce((s, m) => s + m.total, 0);
  const periodSip = monthly.reduce((s, m) => s + m.sip, 0);
  const thisFy = yearly.find((y) => y.year === financialYear(new Date()));
  const kpis = [
    { label: `Invested · last ${months} months`, value: money(periodTotal), hint: `${monthly.filter((m) => m.total > 0).length} active months` },
    { label: "Monthly SIP commitment", value: money(monthlySipCommitment(d.sips)), hint: `${d.sips.filter((s) => s.status === "active").length} active SIPs` },
    { label: "SIP share of inflow", value: periodTotal ? `${Math.round((periodSip / periodTotal) * 100)}%` : "—", hint: `${money(periodSip)} via SIP` },
    { label: `${financialYear(new Date())} total`, value: money(thisFy?.total ?? 0), hint: `${thisFy?.count ?? 0} transactions` },
  ];

  const monthlyCsv = () =>
    downloadCsv(`${fileName}-monthly-report.csv`, monthly.map((m) => ({ Month: m.label, SIP: m.sip, OneTime: m.oneTime, Total: m.total })));
  const yearlyCsv = () =>
    downloadCsv(
      `${fileName}-yearly-report.csv`,
      yearly.map((y) => ({ FinancialYear: y.year, SIP: y.sip, OneTime: y.oneTime, Total: y.total, Transactions: y.count })),
    );

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle={`SIP and one-time flow, financial-year totals and scheme mix for ${scope}.`} />

      <Card className="flex flex-wrap items-end gap-4 !p-5">
        <div className="min-w-52 flex-1">
          <SelectField
            label="Client"
            name="client"
            value={search.client ?? ""}
            placeholder="All clients"
            options={d.clients.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => void navigate({ search: (s) => ({ ...s, client: e.target.value || undefined }) })}
          />
        </div>
        <div className="min-w-44">
          <SelectField
            label="Period"
            name="months"
            value={String(months)}
            options={RANGES}
            onChange={(e) => void navigate({ search: (s) => ({ ...s, months: e.target.value as "6" | "12" | "24" }) })}
          />
        </div>
        <Button variant="secondary" onClick={monthlyCsv} disabled={!d.entries.length}>
          Monthly CSV
        </Button>
        <Button variant="secondary" onClick={yearlyCsv} disabled={!d.entries.length}>
          Yearly CSV
        </Button>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="!p-5">
            <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">{k.label}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{k.value}</p>
            <p className="text-sm text-muted">{k.hint}</p>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 border-b border-line" role="tablist">
        {(["charts", "table"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[15px] font-semibold ${view === v ? "border-ink text-text" : "border-transparent text-muted"}`}
          >
            {v === "charts" ? "Charts" : "Table view"}
          </button>
        ))}
      </div>

      {view === "charts" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold">Monthly investment flow</h2>
            <p className="mb-3 text-sm text-muted">SIP and one-time amounts per month.</p>
            <MonthlyFlowChart data={monthly} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Monthly SIP trend</h2>
            <p className="mb-3 text-sm text-muted">SIP inflow per month.</p>
            <SipTrendChart data={monthly} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">By financial year</h2>
            <p className="mb-3 text-sm text-muted">April to March totals.</p>
            <YearlyTotalsChart data={yearly} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Top schemes</h2>
            <p className="mb-3 text-sm text-muted">Where the money went.</p>
            <SchemeMixChart data={schemes} />
          </Card>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="!p-0">
            <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">By month</h2>
            <table className="w-full text-[15px]">
              <thead className="text-left text-sm text-muted">
                <tr>
                  <th className="px-5 py-2 font-semibold">Month</th>
                  <th className="px-2 py-2 text-right font-semibold">SIP</th>
                  <th className="px-2 py-2 text-right font-semibold">One-time</th>
                  <th className="px-5 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {monthly.map((m) => (
                  <tr key={m.key}>
                    <td className="px-5 py-2">{m.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(m.sip)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(m.oneTime)}</td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="!p-0">
            <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">By financial year</h2>
            <table className="w-full text-[15px]">
              <thead className="text-left text-sm text-muted">
                <tr>
                  <th className="px-5 py-2 font-semibold">Year</th>
                  <th className="px-2 py-2 text-right font-semibold">SIP</th>
                  <th className="px-2 py-2 text-right font-semibold">One-time</th>
                  <th className="px-5 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {yearly.map((y) => (
                  <tr key={y.year}>
                    <td className="px-5 py-2">{y.year}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(y.sip)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(y.oneTime)}</td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums">{money(y.total)}</td>
                  </tr>
                ))}
                {!yearly.length && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      No investments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Top schemes</h2>
            <ul className="divide-y divide-line pb-2">
              {schemes.map((s) => (
                <li key={s.scheme} className="flex justify-between px-5 py-2 text-[15px]">
                  <span className="truncate pr-3">{s.scheme}</span>
                  <span className="font-semibold tabular-nums">{money(s.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
