import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { z } from "zod";
import { listClients } from "@/functions/practice";
import { assignClient, getTeam } from "@/functions/team";
import { Card, inputClass, linkButton, PageHeader } from "@/components/ui";
import { ClientAvatar } from "@/components/client-avatar";
import { Plus } from "lucide-react";
import { money } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/app/clients/")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [clients, team] = await Promise.all([listClients({ data: { q: deps.q } }), getTeam()]);
    return { clients, team };
  },
  head: () => ({ meta: [{ title: "Clients · Anqulas Folio" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { clients, team } = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const canAssign = (me.role === "owner" || me.role === "staff") && team.members.length > 1;
  const people = team.members.filter((m) => m.active);
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} ${q ? "found" : "clients"}`}
        action={
          <div className="flex gap-2">
            {clients.length > 0 && (
              <button
                type="button"
                className="min-h-11 rounded-lg border border-line bg-card px-4 text-[15px] font-semibold hover:border-bronze"
                onClick={() =>
                  void downloadCsv(
                    "clients.csv",
                    clients.map((c) => ({ Name: c.name, Mobile: c.mobile ?? "", Email: c.email ?? "", PAN: c.pan ?? "", ActiveSIPs: c.activeSips, CurrentValue: c.value ?? "" })),
                  )
                }
              >
                Export CSV
              </button>
            )}
            <Link to="/app/clients/new" className={linkButton}>
              <Plus size={18} /> Add client
            </Link>
          </div>
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          void navigate({ search: { q: text || undefined } });
        }}
        className="relative max-w-md"
      >
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={q ?? ""}
          key={q ?? ""}
          placeholder="Name, mobile, email or full PAN"
          aria-label="Search clients"
          className={`${inputClass} !pl-10`}
        />
      </form>
      <Card className="!p-0">
        {clients.length === 0 ? (
          <p className="p-8 text-center text-muted">
            {q ? "No client matches that." : "No clients yet. Add your first client to get started."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => (
              <li key={c.id} className="ink-sweep flex items-center justify-between gap-4 px-5 py-3.5">
                <Link to="/app/clients/$clientId" params={{ clientId: c.id }} className="flex min-w-0 flex-1 items-center gap-3.5">
                  <ClientAvatar name={c.name} />
                  <span className="min-w-0">
                  <p className="truncate font-medium text-text">{c.name}</p>
                  <p className="truncate text-sm text-muted">
                    {[c.mobile, c.email, c.pan].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    {c.value !== null && <p className="font-semibold tabular-nums">{money(c.value)}</p>}
                    <p className="hidden text-sm text-muted sm:block">
                      {c.activeSips > 0 ? `${c.activeSips} active SIP${c.activeSips > 1 ? "s" : ""}` : ""}
                    </p>
                  </div>
                  {canAssign && (
                    <select
                      aria-label={`Who handles ${c.name}`}
                      value={c.assignedUserId ?? ""}
                      onChange={async (e) => {
                        await assignClient({ data: { investorId: c.id, userId: e.target.value || null } });
                        await router.invalidate();
                      }}
                      className="min-h-10 max-w-40 rounded-lg border border-line bg-field px-2 text-sm"
                    >
                      <option value="">Not assigned</option>
                      {people.map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
