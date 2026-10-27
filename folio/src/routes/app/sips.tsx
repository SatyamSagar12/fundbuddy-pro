import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { clientOptions, deleteSip, listSips, saveSip } from "@/functions/ledger";
import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { SIP_FREQUENCIES, SIP_STATUSES, sipSchema, todayIst, type SipForm } from "@/lib/records";
import { day, money } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/sips")({
  validateSearch: z.object({ client: z.string().optional(), add: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ client: search.client }),
  loader: async ({ deps }) => {
    const [rows, clients] = await Promise.all([listSips({ data: { client: deps.client } }), clientOptions()]);
    return { rows, clients };
  },
  head: () => ({ meta: [{ title: "SIPs · Anqulas Folio" }] }),
  component: SipsPage,
});

type Row = Awaited<ReturnType<typeof listSips>>[number];
const STATUS_LABEL: Record<string, string> = { active: "Active", paused: "Paused", stopped: "Stopped", ended: "Ended" };

function SipsPage() {
  const { rows, clients } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [editing, setEditing] = useState<Row | "new" | null>(search.add ? "new" : null);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  const active = rows.filter((r) => r.status === "active");
  const monthly = active.reduce((s, r) => s + (r.frequency === "quarterly" ? r.amount / 3 : r.amount), 0);

  async function remove(r: Row) {
    if (!confirm(`Delete the ${money(r.amount)} SIP in ${r.scheme ?? "this scheme"} for ${r.client}?`)) return;
    const res = await deleteSip({ data: { id: r.id } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setMsg(res.ok ? { tone: "good", text: "Deleted." } : { tone: "error", text: res.error });
    await router.invalidate();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="SIPs"
        subtitle={`${active.length} active · ${money(monthly)} a month`}
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
                      Scheme: r.scheme ?? "",
                      Amount: r.amount,
                      Frequency: r.frequency,
                      StartDate: r.startDate,
                      Status: STATUS_LABEL[r.status] ?? r.status,
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

      {editing && (
        <SipEditor
          key={editing === "new" ? "new" : editing.id}
          clients={clients}
          id={editing === "new" ? undefined : editing.id}
          initial={
            editing === "new"
              ? { investorId: search.client ?? "", scheme: "", amount: 0, frequency: "monthly", startDate: todayIst(), status: "active" }
              : {
                  investorId: editing.investorId,
                  scheme: editing.scheme ?? "",
                  amount: editing.amount,
                  frequency: editing.frequency as SipForm["frequency"],
                  startDate: editing.startDate,
                  status: (editing.status === "ended" ? "stopped" : editing.status) as SipForm["status"],
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

      <div className="max-w-sm">
        <SelectField
          label="Client"
          name="filter"
          value={search.client ?? ""}
          placeholder="All clients"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => void navigate({ search: { client: e.target.value || undefined } })}
        />
      </div>

      <Card className="!p-0">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-muted">No SIPs yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.client}</p>
                  <p className="truncate text-sm text-muted">
                    {r.scheme ?? "—"} · {r.frequency === "quarterly" ? "Quarterly" : "Monthly"} · since {day(r.startDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(r.amount)}</p>
                  <p className={`text-sm ${r.status === "active" ? "text-good" : "text-muted"}`}>{STATUS_LABEL[r.status] ?? r.status}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" aria-label={`Edit ${r.scheme}`} className="rounded-lg p-2 text-muted hover:text-text" onClick={() => setEditing(r)}>
                    <Pencil size={18} />
                  </button>
                  <button type="button" aria-label={`Delete ${r.scheme}`} className="rounded-lg p-2 text-muted hover:text-bad" onClick={() => void remove(r)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
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
          <Field label="Scheme name" name="scheme" defaultValue={initial.scheme} placeholder="e.g. ICICI Bluechip Fund" />
          <Field label="SIP amount (₹)" name="amount" type="number" min={1} step="0.01" inputMode="decimal" defaultValue={initial.amount || ""} />
          <SelectField label="Frequency" name="frequency" defaultValue={initial.frequency} options={SIP_FREQUENCIES} />
          <Field label="Start date" name="startDate" type="date" defaultValue={initial.startDate} />
          <SelectField label="Status" name="status" defaultValue={initial.status} options={SIP_STATUSES} />
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
