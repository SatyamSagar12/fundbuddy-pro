import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteClient, getClient } from "@/functions/clients";
import { Button, Card, linkButtonSecondary, Notice, PageHeader } from "@/components/ui";
import { day, money, txnType } from "@/lib/format";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/clients/$clientId/")({
  loader: async ({ params }) => {
    const c = await getClient({ data: { id: params.clientId } });
    if (!c) throw notFound();
    return c;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.form.name ?? "Client"} · Anqulas Folio` }] }),
  component: ClientPage,
});

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

function ClientPage() {
  const c = Route.useLoaderData();
  const f = c.form;
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const invested = c.transactions.reduce((s, t) => s + (t.type === "redemption" ? -t.amount : t.amount), 0);
  const active = c.sips.filter((s) => s.status === "active");
  const monthly = active.reduce((s, x) => s + (x.frequency === "quarterly" ? x.amount / 3 : x.amount), 0);

  async function remove() {
    if (!confirm(`Delete ${f.name} and all of this client's investments and SIPs? This can't be undone.`)) return;
    const res = await deleteClient({ data: { id: c.id } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    if (res.ok) await navigate({ to: "/app/clients" });
    else setError(res.error);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={f.name}
        subtitle={[f.mobile, f.email].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/app/clients/$clientId/edit" params={{ clientId: c.id }} className={linkButtonSecondary}>
              <Pencil size={16} /> Edit
            </Link>
            {c.canDelete && (
              <Button variant="secondary" onClick={() => void remove()}>
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          ["Invested (recorded)", money(invested)],
          ["Active SIPs", String(active.length)],
          ["SIP per month", money(monthly)],
        ].map(([k, v]) => (
          <Card key={k} className="!p-5">
            <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">{k}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Details</h2>
          <dl className="space-y-3">
            <Detail label="PAN" value={f.pan} />
            <Detail label="Date of birth" value={f.dob ? day(f.dob) : ""} />
            <Detail label="Address" value={f.address} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Bank account</h2>
          <dl className="space-y-3">
            <Detail label="Account number" value={f.bankAccountNo} />
            <Detail label="Bank" value={[f.bankName, f.branch].filter(Boolean).join(", ")} />
            <Detail label="IFSC / MICR" value={[f.ifsc, f.micr].filter(Boolean).join(" / ")} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Nominee</h2>
          {f.nomineeName ? (
            <dl className="space-y-3">
              <Detail label="Name" value={[f.nomineeName, f.nomineeRelation].filter(Boolean).join(" · ")} />
              <Detail label="Date of birth / PAN" value={[f.nomineeDob ? day(f.nomineeDob) : "", f.nomineePan].filter(Boolean).join(" · ")} />
              <Detail label="Contact" value={[f.nomineeMobile, f.nomineeEmail].filter(Boolean).join(" · ")} />
            </dl>
          ) : (
            <p className="text-[15px] text-bad">No nominee recorded.</p>
          )}
        </Card>
      </div>

      {f.notes && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Notes</h2>
          <p className="whitespace-pre-wrap">{f.notes}</p>
        </Card>
      )}

      <Card className="!p-0">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">SIPs</h2>
          <Link to="/app/sips" search={{ client: c.id, add: true }} className="inline-flex items-center gap-1 font-semibold text-bronze">
            <Plus size={16} /> Add SIP
          </Link>
        </div>
        {c.sips.length === 0 ? (
          <p className="px-5 pb-5 text-muted">No SIPs.</p>
        ) : (
          <ul className="divide-y divide-line">
            {c.sips.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.scheme ?? "—"}</p>
                  <p className="text-sm text-muted">
                    {s.frequency === "quarterly" ? "Quarterly" : "Monthly"} · since {day(s.startDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(s.amount)}</p>
                  <p className={`text-sm ${s.status === "active" ? "text-good" : "text-muted"}`}>{s.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="!p-0">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Investments</h2>
          <Link to="/app/investments" search={{ client: c.id, add: true }} className="inline-flex items-center gap-1 font-semibold text-bronze">
            <Plus size={16} /> Add investment
          </Link>
        </div>
        {c.transactions.length === 0 ? (
          <p className="px-5 pb-5 text-muted">No investments.</p>
        ) : (
          <ul className="divide-y divide-line">
            {c.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.scheme ?? "—"}</p>
                  <p className="text-sm text-muted">
                    {day(t.date)}
                    {t.paymentMode ? ` · ${t.paymentMode}` : ""}
                    {t.reference ? ` · ${t.reference}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(t.amount)}</p>
                  <p className="text-sm text-muted">{txnType(t.type)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
