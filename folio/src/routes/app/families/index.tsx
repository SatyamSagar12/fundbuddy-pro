import { createFileRoute, Link } from "@tanstack/react-router";
import { Crown, Plus } from "lucide-react";
import { listFamilies } from "@/functions/families";
import { Card, EmptyState, linkButton, order, PageHeader } from "@/components/ui";
import { ClientsTabs } from "@/components/clients-tabs";
import { downloadCsv } from "@/lib/csv";
import { gainTone, money, percent } from "@/lib/format";

export const Route = createFileRoute("/app/families/")({
  loader: () => listFamilies(),
  head: () => ({ meta: [{ title: "Families · Anqulas Folio" }] }),
  component: FamiliesPage,
});

function FamiliesPage() {
  const { families, notInFamily } = Route.useLoaderData();
  const people = families.reduce((s, f) => s + f.members.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Families"
        subtitle={
          families.length
            ? `${families.length} ${families.length === 1 ? "family" : "families"} · ${people} clients${notInFamily ? ` · ${notInFamily} not in a family yet` : ""}`
            : undefined
        }
        action={
          <div className="flex gap-2">
            {families.length > 0 && (
              <button
                type="button"
                className="min-h-11 rounded-lg border border-line bg-card px-4 text-[15px] font-semibold hover:border-bronze"
                onClick={() =>
                  void downloadCsv(
                    "families.csv",
                    families.map((f) => ({
                      Family: f.name,
                      Head: f.head?.name ?? "",
                      Members: f.members.map((x) => x.name).join("; "),
                      CurrentValue: Math.round(f.total.value),
                      Invested: Math.round(f.invested),
                      Gain: Math.round(f.total.gain),
                      [f.shown.label]: f.shown.value === null ? "" : (f.shown.value * 100).toFixed(1) + "%",
                    })),
                  )
                }
              >
                Export CSV
              </button>
            )}
            <Link to="/app/families/new" className={linkButton}>
              <Plus size={18} /> New family
            </Link>
          </div>
        }
      />
      <ClientsTabs />

      {families.length === 0 ? (
        <EmptyState
          title="No families yet"
          description="Group clients who belong together, like a husband, wife and parents, to see their money as one."
          action={
            <Link to="/app/families/new" className={linkButton}>
              <Plus size={18} /> New family
            </Link>
          }
        />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {families.map((f, i) => (
              <li key={f.id} className="ink-sweep reveal" style={order(i)}>
                <Link
                  to="/app/families/$familyId"
                  params={{ familyId: f.id }}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">{f.name}</span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {f.members.map((x, j) => (
                        <span key={x.id}>
                          {j > 0 && " · "}
                          {x.isHead && <Crown size={13} aria-label="Head of family" className="mr-1 inline -translate-y-px text-bronze" />}
                          {x.name}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="grid shrink-0 grid-cols-3 gap-4 text-right sm:w-[22rem]">
                    <span>
                      <span className="eyebrow block text-muted">Value</span>
                      <span className="font-semibold tabular-nums">{money(f.total.value)}</span>
                    </span>
                    <span>
                      <span className="eyebrow block text-muted">Invested</span>
                      <span className="tabular-nums">{money(f.invested)}</span>
                    </span>
                    <span>
                      <span className="eyebrow block text-muted">Gain</span>
                      <span className={`tabular-nums ${gainTone(f.total.gain)}`}>{money(f.total.gain)}</span>
                      <span className="block text-[13px] text-muted">
                        {f.shown.label} {percent(f.shown.value)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
