import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Crown, Landmark, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteFamily, getFamily } from "@/functions/families";
import { Button, Card, linkButtonSecondary, Notice, PageHeader } from "@/components/ui";
import { HoldingsTable, SummaryTiles } from "@/components/holdings-table";
import { StatementButton } from "@/components/statement-button";
import { getStatement } from "@/functions/statement";
import { ClientAvatar } from "@/components/client-avatar";
import { day, gainTone, money, percent } from "@/lib/format";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/families/$familyId/")({
  loader: async ({ params }) => {
    const f = await getFamily({ data: { id: params.familyId } });
    if (!f) throw notFound();
    return f;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? "Family"} · Anqulas Folio` }] }),
  component: FamilyPage,
});

function FamilyPage() {
  const f = Route.useLoaderData();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const tot = f.total;
  const valued = f.holdings.length > 0;

  async function remove() {
    if (!confirm(`Delete the family “${f.name}”? Its clients and their investments stay; they're only ungrouped.`)) return;
    const res = await deleteFamily({ data: { id: f.id } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    if (res.ok) await navigate({ to: "/app/families" });
    else setError(res.error);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Family"
        title={f.name}
        subtitle={`${f.head ? `Head: ${f.head.name} · ` : ""}${f.members.length} member${f.members.length === 1 ? "" : "s"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <StatementButton load={() => getStatement({ data: { family: f.id } })} />
            <Link to="/app/capital-gains" search={{ family: f.id }} className={linkButtonSecondary}>
              <Landmark size={16} /> Capital gains
            </Link>
            <Link to="/app/families/$familyId/edit" params={{ familyId: f.id }} className={linkButtonSecondary}>
              <Pencil size={16} /> Edit
            </Link>
            {f.canDelete && (
              <Button variant="secondary" onClick={() => void remove()}>
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      <SummaryTiles
        tiles={[
          { k: "Current value", v: valued ? money(tot.value) : "—", sub: tot.navDate ? `NAV of ${day(tot.navDate)}` : "" },
          { k: "Gain", v: valued ? money(tot.gain) : "—", sub: valued ? `${f.shown.label} ${percent(f.shown.value)}` : "", tone: gainTone(tot.gain) },
          { k: "Invested", v: money(f.invested), sub: f.notMatched ? "Includes schemes not matched yet" : "Cost of units held" },
          { k: "SIPs", v: money(f.sips.monthly), sub: `${f.sips.active} active · per month` },
        ]}
      />

      <Card className="!p-0">
        <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Members</h2>
        <ul className="divide-y divide-line">
          {f.members.map((x) => (
            <li key={x.id} className="ink-sweep">
              <Link to="/app/clients/$clientId" params={{ clientId: x.id }} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <ClientAvatar name={x.name} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{x.name}</span>
                    {x.isHead && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-bronze">
                        <Crown size={13} /> Head of family
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{money(x.value)}</span>
                  <span className={`block text-[13px] tabular-nums ${gainTone(x.gain)}`}>{money(x.gain)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Holdings</h2>
          {tot.pendingUnits > 0 && <p className="text-sm text-muted">{tot.pendingUnits} entries waiting for their NAV</p>}
        </div>
        <HoldingsTable
          holdings={f.holdings}
          unmatched={f.unmatched}
          unmatchedNote={
            <Link to="/app/schemes" className="text-[13px] link-draw font-medium text-bronze">
              Match this scheme to see its value
            </Link>
          }
        />
      </Card>
    </div>
  );
}
