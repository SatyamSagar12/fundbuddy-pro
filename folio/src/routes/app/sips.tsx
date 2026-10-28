import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { clientOptions, deleteSip, listSips, saveSip } from "@/functions/ledger";
import { Button, Card, Field, Notice, PageHeader, SelectField, order, textLink } from "@/components/ui";
import { SIP_STATUS } from "@/lib/sip-book";
import { SchemePicker } from "@/components/scheme-picker";
import { ClientAvatar } from "@/components/client-avatar";
import { SIP_FREQUENCIES, SIP_STATUSES, sipSchema, todayIst, type SipForm } from "@/lib/records";
import { day, money } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/sips")({
  validateSearch: z.object({
    client: z.string().optional(),
    add: z.boolean().optional(),
    show: z.enum(["all", "active", "bounced", "missed", "ending", "stopped"]).optional(),
  }),
  loaderDeps: ({ search }) => ({ client: search.client }),
  loader: async ({ deps }) => {
    const [book, clients] = await Promise.all([listSips({ data: { client: deps.client } }), clientOptions()]);
    return { ...book, clients };
  },
  head: () => ({ meta: [{ title: "SIPs · Anqulas Folio" }] }),
  component: SipsPage,
});

type Row = Awaited<ReturnType<typeof listSips>>["rows"][number];
type Show = "all" | "active" | "bounced" | "missed" | "ending" | "stopped";

const FREQ: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", daily: "Daily" };

function matches(r: Row, show: Show): boolean {
  if (show === "all") return true;
  if (show === "ending") return r.endingSoon;
  if (show === "stopped") return r.status === "stopped" || r.status === "paused";
  return r.status === show;
}

function SipsPage() {
  const { rows, clients, totals, inflow } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [editing, setEditing] = useState<Row | "new" | null>(search.add ? "new" : null);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const show: Show = search.show ?? "all";
  const shown = rows.filter((r) => matches(r, show));
  const counts: Record<Show, number> = {
    all: rows.length,
    active: totals.active,
    bounced: totals.bounced,
    missed: totals.missed,
    ending: totals.endingSoon,
    stopped: rows.filter((r) => matches(r, "stopped")).length,
  };
  const tabs: { k: Show; label: string }[] = [
    { k: "all", label: "All" },
    { k: "active", label: "Active" },
    { k: "bounced", label: "Bounced" },
    { k: "missed", label: "Missed" },
    { k: "ending", label: "Ending soon" },
    { k: "stopped", label: "Stopped" },
  ];

  async function remove(r: Row) {
    if (!r.typedId) return;
    if (!confirm(`Delete the ${money(r.amount)} SIP in ${r.scheme} for ${r.client}?`)) return;
    const res = await deleteSip({ data: { id: r.typedId } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setMsg(res.ok ? { tone: "good", text: "Deleted." } : { tone: "error", text: res.error });
    await router.invalidate();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="SIPs"
        subtitle={`${totals.active + totals.bounced} running · ${money(totals.monthly)} a month`}
        action={
          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    "sips.csv",
                    rows.map((r) => ({
                      Client: r.client,
                      Scheme: r.scheme,
                      Folio: r.folioNo ?? "",
                      Amount: r.amount,
                      Frequency: FREQ[r.frequency] ?? r.frequency,
                      StartDate: r.startDate,
                      LastPaid: r.lastPaid ?? "",
                      NextDue: r.nextDue ?? "",
                      BouncesLast12Months: r.bouncesYear,
                      Status: SIP_STATUS[r.status]?.label ?? r.status,
                      EndingSoon: r.endingSoon ? "Yes" : "",
                      From: r.auto ? "Registrar" : "Typed",
                    })),
                  )
                }
              >
                Export CSV
              </Button>
            )}
            <Button onClick={() => setEditing("new")} disabled={clients.length === 0}>
              <Plus size={18} /> Add SIP
            </Button>
          </div>
        }
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {clients.length === 0 && <Notice>Add a client first, then record their SIPs here.</Notice>}
      {totals.bounced > 0 && show !== "bounced" && (
        <Notice tone="error">
          {totals.bounced === 1 ? "1 SIP bounced" : `${totals.bounced} SIPs bounced`}: the bank returned the latest
          instalment.{" "}
          <Link to="/app/sips" search={{ show: "bounced", client: search.client }} className={textLink}>
            See who to call
          </Link>
        </Notice>
      )}

      {editing && (
        <SipEditor
          key={editing === "new" ? "new" : editing.id}
          clients={clients}
          id={editing === "new" ? undefined : (editing.typedId ?? undefined)}
          initial={
            editing === "new"
              ? { investorId: search.client ?? "", scheme: "", instrumentId: "", amount: 0, frequency: "monthly", startDate: todayIst(), status: "active", endDate: "" }
              : {
                  investorId: editing.investorId,
                  scheme: editing.scheme,
                  instrumentId: editing.instrumentId ?? "",
                  amount: editing.amount,
                  frequency: (editing.frequency === "quarterly" ? "quarterly" : "monthly") as SipForm["frequency"],
                  startDate: editing.startDate,
                  status: (editing.status === "paused" ? "paused" : editing.status === "stopped" ? "stopped" : "active") as SipForm["status"],
                  endDate: editing.endDate ?? "",
                }
          }
          onDone={async (text) => {
            setEditing(null);
            setMsg({ tone: "good", text });
            await router.invalidate();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {inflow.some((m) => m.amount > 0) && <InflowChart inflow={inflow} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 whitespace-nowrap" role="tablist" aria-label="Show SIPs">
          {tabs.map((t) => (
            <button
              key={t.k}
              type="button"
              role="tab"
              aria-selected={show === t.k}
              onClick={() => void navigate({ search: (s) => ({ ...s, show: t.k === "all" ? undefined : t.k }) })}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                show === t.k ? "border-text bg-text text-paper" : "border-line text-muted hover:text-text"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-70">{counts[t.k]}</span>
            </button>
          ))}
        </div>
        <div className="w-full max-w-xs">
          <SelectField
            label="Client"
            name="filter"
            value={search.client ?? ""}
            placeholder="All clients"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => void navigate({ search: (s) => ({ ...s, client: e.target.value || undefined }) })}
          />
        </div>
      </div>

      <Card className="!p-0">
        {shown.length === 0 ? (
          <p className="p-8 text-center text-muted">{rows.length === 0 ? "No SIPs yet. They appear here by themselves once registrar files are imported." : "None here."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id} className="ink-sweep flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <ClientAvatar name={r.client} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    <Link to="/app/clients/$clientId" params={{ clientId: r.investorId }} className="hover:underline">
                      {r.client}
                    </Link>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {r.scheme}
                    {r.folioNo ? ` · folio ${r.folioNo}` : ""}
                  </p>
                  <p className="text-[13px] text-muted">
                    {FREQ[r.frequency] ?? r.frequency}
                    {r.lastPaid ? ` · last paid ${day(r.lastPaid)}` : ` · since ${day(r.startDate)}`}
                    {r.nextDue && r.status !== "stopped" ? ` · next ${day(r.nextDue)}` : ""}
                    {r.bouncesYear > 0 ? ` · ${r.bouncesYear} bounce${r.bouncesYear > 1 ? "s" : ""} this year` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(r.amount)}</p>
                  <p className={`text-sm ${SIP_STATUS[r.status]?.tone ?? "text-muted"}`} title={SIP_STATUS[r.status]?.hint}>
                    {SIP_STATUS[r.status]?.label ?? r.status}
                    {r.endingSoon ? " · ending soon" : ""}
                  </p>
                </div>
                <div className="flex w-[76px] justify-end gap-1">
                  {r.typedId ? (
                    <>
                      <button type="button" aria-label={`Edit ${r.scheme}`} className="rounded-lg p-2 text-muted hover:text-text" onClick={() => setEditing(r)}>
                        <Pencil size={18} />
                      </button>
                      <button type="button" aria-label={`Delete ${r.scheme}`} className="rounded-lg p-2 text-muted hover:text-bad" onClick={() => void remove(r)}>
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <span className="eyebrow text-muted" title="Found in the registrar's transactions; kept up to date by itself">
                      Auto
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {rows.some((r) => r.auto) && (
        <p className="text-[13px] text-muted">
          SIPs marked Auto are found in the CAMS and KFintech transactions, and their status updates with every import.
          A bounce is an instalment the registrar reversed.
        </p>
      )}
    </div>
  );
}

function InflowChart({ inflow }: { inflow: { month: string; amount: number }[] }) {
  const max = Math.max(...inflow.map((m) => m.amount), 1);
  const label = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  const last = inflow.at(-1)!;
  const prev = inflow.at(-2);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">SIP money received</h2>
        <p className="text-sm text-muted">
          This month so far <b className="font-semibold text-text tabular-nums">{money(last.amount)}</b>
          {prev ? ` · last month ${money(prev.amount)}` : ""}
        </p>
      </div>
      <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="SIP money received in each of the last 12 months">
        {inflow.map((m, i) => (
          <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${label(m.month)}: ${money(m.amount)}`}>
            <div
              className={`grow-y w-full rounded-t ${i === inflow.length - 1 ? "bg-bronze/60" : "bg-bronze"}`}
              style={{ height: `${Math.max(2, (m.amount / max) * 100)}%`, ...order(i) }}
            />
            <span className="text-[11px] text-muted">{label(m.month)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SipEditor({
  id,
  initial,
  clients,
  onDone,
  onCancel,
}: {
  id: string | undefined;
  initial: SipForm;
  clients: { id: string; name: string }[];
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = sipSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? SOMETHING_WRONG);
    setBusy(true);
    setError(null);
    try {
      const res = await saveSip({ data: { id, sip: parsed.data } });
      if (res.ok) await onDone(id ? "SIP updated." : "SIP added.");
      else setError(res.error);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">{id ? "Edit SIP" : "Add SIP"}</h2>
      <form method="post" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Client" name="investorId" defaultValue={initial.investorId} placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          <SchemePicker initialName={initial.scheme} initialId={initial.instrumentId || null} />
          <Field label="SIP amount (₹)" name="amount" type="number" min={1} step="0.01" inputMode="decimal" defaultValue={initial.amount || ""} />
          <SelectField label="Frequency" name="frequency" defaultValue={initial.frequency} options={SIP_FREQUENCIES} />
          <Field label="Start date" name="startDate" type="date" defaultValue={initial.startDate} />
          <SelectField label="Status" name="status" defaultValue={initial.status} options={SIP_STATUSES} />
          <Field label="Last instalment (optional)" name="endDate" type="date" defaultValue={initial.endDate} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
