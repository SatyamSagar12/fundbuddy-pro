import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { z } from "zod";
import { listClients } from "@/functions/practice";
import { Card } from "@/components/ui";

export const Route = createFileRoute("/app/clients")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => listClients({ data: { q: deps.q } }),
  head: () => ({ meta: [{ title: "Clients · Anqulas Folio" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const clients = Route.useLoaderData();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-semibold tracking-tight">Clients</h1>
        <p className="text-muted">{clients.length} {q ? "found" : "clients"}</p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          void navigate({ search: { q: text || undefined } });
        }}
        className="relative max-w-md"
      >
        <Search size={18} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={q ?? ""}
          key={q ?? ""}
          placeholder="Name, mobile, email or full PAN"
          aria-label="Search clients"
          className="min-h-12 w-full rounded-lg border border-line bg-white pr-3 pl-10 text-[17px] outline-none focus:border-bronze"
        />
      </form>
      <Card className="!p-0">
        {clients.length === 0 ? (
          <p className="p-8 text-center text-muted">{q ? "No client matches that." : "No clients yet."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="truncate text-sm text-muted">
                    {[c.mobile, c.email, c.pan].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-muted">
                  {c.activeSips > 0 ? `${c.activeSips} active SIP${c.activeSips > 1 ? "s" : ""}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
