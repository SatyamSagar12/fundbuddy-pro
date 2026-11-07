import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { clientOptions, deleteInvestment, listInvestments, saveInvestment } from "@/functions/ledger";
import { Button, Card, Field, linkButtonSecondary, Notice, PageHeader, SelectField } from "@/components/ui";
import { SchemePicker } from "@/components/scheme-picker";
import { ClientAvatar } from "@/components/client-avatar";
import { INVESTMENT_TYPES, investmentSchema, PAYMENT_MODES, todayIst, type InvestmentForm } from "@/lib/records";
import { day, money, navText, txnType, units } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/investments")({
  validateSearch: z.object({ client: z.string().optional(), add: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ client: search.client }),
  loader: async ({ deps }) => {
    const [rows, clients] = await Promise.all([listInvestments({ data: { client: deps.client } }), clientOptions()]);
    return { rows, clients };
  },
  head: () => ({ meta: [{ title: "Investments · Anqulas Folio" }] }),
  component: InvestmentsPage,
});

type Row = Awaited<ReturnType<typeof listInvestments>>[number];

function InvestmentsPage() {
  const { rows, clients } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const { me } = Route.useRouteContext();
  const [editing, setEditing] = useState<Row | "new" | null>(search.add ? "new" : null);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  const total = rows.reduce((s, r) => s + (r.type === "redemption" ? -r.amount : r.amount), 0);

  async function remove(r: Row) {
    if (!confirm(`Delete ${money(r.amount)} in ${r.scheme ?? "this scheme"} for ${r.client}?`)) return;
    const res = await deleteInvestment({ data: { id: r.id } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setMsg(res.ok ? { tone: "good", text: "Deleted." } : { tone: "error", text: res.error });
    await router.invalidate();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investments"
        subtitle={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} · ${money(total)} net`}
        action={
          <div className="flex flex-wrap gap-2">
            {me.role !== "subbroker" && (
              <Link to="/app/import" className={linkButtonSecondary}>
                Import
              </Link>
            )}
            {rows.some((r) => !r.instrumentId) && (
              <Link to="/app/schemes" className={linkButtonSecondary}>
                Match schemes
              </Link>
            )}
            {rows.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    "investments.csv",
                    rows.map((r) => ({
                      Date: r.date,
                      Client: r.client,
                      Scheme: r.scheme ?? "",
                      Type: txnType(r.type),
                      Amount: r.amount,
                      PaymentMode: r.paymentMode ?? "",
                      TransactionID: r.reference ?? "",
                    })),
                  )
                }
              >
                Export CSV
              </Button>
            )}
            <Button onClick={() => setEditing("new")} disabled={clients.length === 0}>
              <Plus size={18} /> Add investment
            </Button>
          </div>
        }
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {clients.length === 0 && <Notice>Add a client first, then record their investments here.</Notice>}

      {editing && (
        <InvestmentEditor
          key={editing === "new" ? "new" : editing.id}
          clients={clients}
          initial={
            editing === "new"
              ? { investorId: search.client ?? "", scheme: "", instrumentId: "", type: "purchase", amount: 0, date: todayIst(), paymentMode: "online", reference: "" }
              : {
                  investorId: editing.investorId,
                  scheme: editing.scheme ?? "",
                  instrumentId: editing.instrumentId ?? "",
                  type: editing.type as InvestmentForm["type"],
                  amount: editing.amount,
                  date: editing.date,
                  paymentMode: (editing.paymentMode ?? "online") as InvestmentForm["paymentMode"],
                  reference: editing.reference ?? "",
                }
          }
          id={editing === "new" ? undefined : editing.id}
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
          <p className="p-8 text-center text-muted">No investments yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="ink-sweep flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <ClientAvatar name={r.client} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.client}</p>
                  <p className="truncate text-sm text-muted">
                    {r.scheme ?? "—"} · {day(r.date)}
                    {r.paymentMode ? ` · ${r.paymentMode}` : ""}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </p>
                  {r.units !== null ? (
                    <p className="text-[13px] text-muted">
                      {r.unitsEstimated ? "≈ " : ""}
                      {units(r.units)} units at {navText(r.nav)}
                    </p>
                  ) : !r.instrumentId ? (
                    <p className="text-[13px] text-bronze">Scheme not matched yet</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(r.amount)}</p>
                  <p className="text-sm text-muted">{txnType(r.type)}</p>
                </div>
                <div className="flex gap-1">
                  {r.source === "manual" && (
                    <button type="button" aria-label={`Edit ${r.scheme}`} className="rounded-lg p-2 text-muted hover:text-text" onClick={() => setEditing(r)}>
                      <Pencil size={18} />
                    </button>
                  )}
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

function InvestmentEditor({
  id,
  initial,
  clients,
  onDone,
  onCancel,
}: {
  id: string | undefined;
  initial: InvestmentForm;
  clients: { id: string; name: string }[];
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = investmentSchema.safeParse(Object.fromEntries(f));
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? SOMETHING_WRONG);
    setBusy(true);
    setError(null);
    try {
      const res = await saveInvestment({ data: { id, investment: parsed.data } });
      if (res.ok) await onDone(`${id ? "Investment updated." : "Investment added."}${res.matched ? "" : " The scheme isn't matched yet: match it under Investments → Match schemes."}`);
      else setError(res.error);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">{id ? "Edit investment" : "Add investment"}</h2>
      <form method="post" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Client" name="investorId" defaultValue={initial.investorId} placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          <SchemePicker initialName={initial.scheme} initialId={initial.instrumentId || null} />
          <SelectField label="Type" name="type" defaultValue={initial.type} options={INVESTMENT_TYPES} />
          <Field label="Amount (₹)" name="amount" type="number" min={1} step="0.01" inputMode="decimal" defaultValue={initial.amount || ""} />
          <Field label="Date" name="date" type="date" defaultValue={initial.date} />
          <SelectField label="Payment mode" name="paymentMode" defaultValue={initial.paymentMode} options={PAYMENT_MODES} />
          <div className="sm:col-span-2">
            <Field label="Transaction ID (optional)" name="reference" defaultValue={initial.reference} />
          </div>
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
