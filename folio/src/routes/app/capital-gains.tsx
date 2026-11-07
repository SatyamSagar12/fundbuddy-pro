import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download } from "lucide-react";
import { z } from "zod";
import { getCapitalGains } from "@/functions/capital-gains";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { SummaryTiles } from "@/components/holdings-table";
import { downloadCsv } from "@/lib/csv";
import { day, gainTone, money, units } from "@/lib/format";
import { rateText } from "@/lib/tax-rules";

export const Route = createFileRoute("/app/capital-gains")({
  validateSearch: z.object({ client: z.uuid().optional(), family: z.uuid().optional(), fy: z.number().int().optional() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.client === !deps.family) throw notFound();
    const r = await getCapitalGains({ data: deps });
    if (!r) throw notFound();
    return r;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Capital gains · ${loaderData?.title ?? ""} · Anqulas Folio` }] }),
  component: CapitalGainsPage,
});

const PROBLEM: Record<string, string> = {
  no_units: "has an entry still waiting for its units (its NAV isn't in yet), so it's left out",
  sold_more_than_bought: "sold more units than Folio has purchases for; the extra units are left out. Import the registrar's full history to fix this",
  before_rules: "was sold before April 2017, which these rules don't cover",
};

function CapitalGainsPage() {
  const r = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const t = r.total;
  const back = r.isFamily
    ? { to: "/app/families/$familyId" as const, params: { familyId: r.familyId! } }
    : { to: "/app/clients/$clientId" as const, params: { clientId: r.clientId! } };

  function csv() {
    downloadCsv(
      `capital-gains-${r.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${r.fyLabel.replace(/\s+/g, "")}.csv`,
      r.lines.map((l) => ({
        Client: l.client,
        Folio: l.folioNo,
        Scheme: l.scheme,
        "Taxed as": l.taxedAs + (l.guessed ? " (check)" : ""),
        "Sold on": l.sold,
        "Bought on": l.bought,
        Units: l.units,
        "Sale value": l.saleValue,
        "Purchase cost": l.cost,
        "Cost used": l.costUsed,
        "Indexed cost": l.indexedCost ?? "",
        Grandfathered: l.grandfathered ? "Yes (31 Jan 2018 value)" : "",
        Gain: l.gain,
        Term: l.term === "long" ? "Long-term" : "Short-term",
        Rate: rateText(l.rate),
      })),
    );
  }

  return (
    <div className="space-y-5">
      <Link {...back} className="reveal inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-text">
        <ArrowLeft size={16} /> {r.title}
      </Link>
      <PageHeader
        eyebrow="Capital gains"
        title={r.title}
        subtitle={`${r.fyLabel} · sales matched to the oldest units first, per folio and scheme`}
        action={
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Financial year"
              value={r.fy}
              onChange={(e) => void navigate({ search: { ...search, fy: Number(e.target.value) } })}
              className="min-h-11 rounded-full border border-line bg-field px-4 text-[15px] font-medium"
            >
              {r.years.map((y) => (
                <option key={y.fy} value={y.fy}>
                  {y.label}
                </option>
              ))}
            </select>
            {r.lines.length > 0 && (
              <button type="button" onClick={csv} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[15px] font-medium hover:bg-soft">
                <Download size={16} /> Download CSV
              </button>
            )}
          </div>
        }
      />

      {r.unmatchedSales > 0 && (
        <Notice tone="warn">
          {r.unmatchedSales} redemption{r.unmatchedSales === 1 ? " is" : "s are"} in schemes not matched yet, so not counted.{" "}
          <Link to="/app/schemes" className="link-draw font-semibold">
            Match schemes
          </Link>
        </Notice>
      )}
      {r.problems.map((p, i) => (
        <Notice key={i} tone="warn">
          {p.scheme} ({day(p.date)}) {PROBLEM[p.kind]}.
        </Notice>
      ))}

      {r.lines.length === 0 ? (
        <EmptyState title={`No sales in ${r.fyLabel}`} description="Redemptions and switches out appear here with their gains. Pick another year above to see earlier sales." />
      ) : (
        <>
          <SummaryTiles
            tiles={[
              { k: "Total gain", v: money(t.gain), sub: `on sales of ${money(t.saleValue)}`, tone: gainTone(t.gain) },
              { k: "Short-term", v: money(t.shortTerm), tone: gainTone(t.shortTerm) },
              { k: "Long-term", v: money(t.longTerm), tone: gainTone(t.longTerm) },
              { k: "Estimated tax", v: money(t.estimatedTax), sub: t.slabIncome > 0 ? `plus slab tax on ${money(t.slabIncome)}` : "before surcharge and cess" },
            ]}
          />

          <Card className="!p-0">
            <h2 className="px-5 pt-5 pb-1 text-lg font-semibold">How it's taxed</h2>
            <p className="px-5 pb-3 text-sm text-muted">
              Losses are set off only within the same row here. {r.isFamily ? "The yearly exemption is per person." : ""}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[15px]">
                <thead>
                  <tr className="eyebrow border-b border-line text-left text-muted">
                    <th className="px-5 py-2">Kind</th>
                    <th className="px-3 py-2 text-right">Gains</th>
                    <th className="px-3 py-2 text-right">Losses</th>
                    <th className="px-3 py-2 text-right">Exempt</th>
                    <th className="px-5 py-2 text-right">Est. tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {t.buckets.map((b) => (
                    <tr key={b.key}>
                      <td className="px-5 py-3 font-medium">{b.label}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(b.gains)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{b.losses ? money(-b.losses) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{b.exempted ? money(b.exempted) : "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{b.tax === null ? "At slab" : money(b.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {r.isFamily && r.perPerson.length > 0 && (
            <Card className="!p-0">
              <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">By member</h2>
              <ul className="divide-y divide-line">
                {r.perPerson.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <Link to="/app/capital-gains" search={{ client: p.id, fy: r.fy }} className="link-draw font-medium">
                      {p.name}
                    </Link>
                    <span className="flex gap-5 text-right text-[14px] tabular-nums">
                      <span>
                        <span className="eyebrow block text-muted">Short</span>
                        {money(p.summary.shortTerm)}
                      </span>
                      <span>
                        <span className="eyebrow block text-muted">Long</span>
                        {money(p.summary.longTerm)}
                      </span>
                      <span>
                        <span className="eyebrow block text-muted">Est. tax</span>
                        {money(p.summary.estimatedTax)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="!p-0">
            <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Each sale</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[15px]">
                <thead>
                  <tr className="eyebrow border-b border-line text-left text-muted">
                    <th className="px-5 py-2">Scheme</th>
                    <th className="px-3 py-2">Sold · bought</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Sale value</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-5 py-2 text-right">Gain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3">
                        <p className="font-semibold leading-snug">{l.scheme}</p>
                        <p className="text-[13px] text-muted">
                          {[r.isFamily ? l.client : null, l.folioNo ? `Folio ${l.folioNo}` : null, l.taxedAs + (l.guessed ? " (please check)" : "")].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {day(l.sold)}
                        <p className="text-[13px] text-muted">{day(l.bought)}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{units(l.units)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(l.saleValue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {money(l.indexedCost ?? l.costUsed)}
                        {l.grandfathered && <p className="text-[13px] text-muted">31 Jan 2018 value</p>}
                        {l.indexedCost !== null && <p className="text-[13px] text-muted">indexed</p>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${gainTone(l.gain)}`}>
                        {money(l.gain)}
                        <p className="text-[13px] text-muted">
                          {l.term === "long" ? "Long" : "Short"} · {rateText(l.rate)}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {r.guessed.length > 0 && (
        <Notice tone="info">
          Please check how these are taxed; Folio guessed from the scheme's category: {r.guessed.join(", ")}.
        </Notice>
      )}
      {r.grandfatherNavMissing.length > 0 && (
        <Notice tone="warn">
          The 31 Jan 2018 NAV couldn't be found for {r.grandfatherNavMissing.join(", ")}, so the actual cost is used. The gain may be lower.
        </Notice>
      )}
      <p className="reveal text-[13px] leading-relaxed text-muted">
        An estimate to help plan, not a tax return: check with the client's CA before filing. {r.rulesVersion}.
      </p>
    </div>
  );
}
