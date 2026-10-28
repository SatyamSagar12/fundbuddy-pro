import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { monthlyAmount, SIP_STATUS } from "@/lib/sip-book";
import { Crown, Landmark, Mail, Pencil, Plus, Smartphone, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { deleteClient, getClient } from "@/functions/clients";
import { clientFamily, setClientFamily } from "@/functions/families";
import { portalOn, sendPortalLink } from "@/functions/portal";
import { Button, Card, linkButtonSecondary, Notice, PageHeader } from "@/components/ui";
import { HoldingsTable, SummaryTiles } from "@/components/holdings-table";
import { StatementButton } from "@/components/statement-button";
import { getStatement } from "@/functions/statement";
import { day, gainTone, money, percent, txnType, units } from "@/lib/format";
import { shownReturn } from "@/lib/holdings";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/clients/$clientId/")({
  loader: async ({ params }) => {
    const [c, family, portal] = await Promise.all([getClient({ data: { id: params.clientId } }), clientFamily({ data: { id: params.clientId } }), portalOn()]);
    if (!c) throw notFound();
    return { ...c, family, portal };
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

  const tot = c.total;
  const ret = shownReturn(tot);
  const valued = c.holdings.length > 0;
  const unmatchedInvested = c.unmatched.reduce((s, u) => s + u.netInvested, 0);
  const active = c.sips.filter((s) => s.status === "active" || s.status === "bounced");
  const monthly = active.reduce((s, x) => s + monthlyAmount(x.amount, x.frequency), 0);

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
            <StatementButton load={() => getStatement({ data: { client: c.id } })} />
            <Link to="/app/capital-gains" search={{ client: c.id }} className={linkButtonSecondary}>
              <Landmark size={16} /> Capital gains
            </Link>
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

      <SummaryTiles
        tiles={[
          { k: "Current value", v: valued ? money(tot.value) : "—", sub: tot.navDate ? `NAV of ${day(tot.navDate)}` : "" },
          { k: "Gain", v: valued ? money(tot.gain) : "—", sub: valued ? `${ret.label} ${percent(ret.value)}` : "", tone: gainTone(tot.gain) },
          { k: "Invested", v: money(tot.cost + unmatchedInvested), sub: unmatchedInvested ? "Includes schemes not matched yet" : "Cost of units held" },
          { k: "SIPs", v: money(monthly), sub: `${active.length} running · per month` },
        ]}
      />

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Holdings</h2>
          {tot.pendingUnits > 0 && <p className="text-sm text-muted">{tot.pendingUnits} entries waiting for their NAV</p>}
        </div>
        <HoldingsTable
          holdings={c.holdings}
          unmatched={c.unmatched}
          unmatchedNote={
            <Link to="/app/schemes" className="text-[13px] link-draw font-medium text-bronze">
              Match this scheme to see its value
            </Link>
          }
        />
      </Card>

      {c.family && <FamilyCard clientId={c.id} name={f.name} family={c.family} />}
      <PortalCard clientId={c.id} name={f.name} email={f.email} portal={c.portal} />

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
              <li key={s.id} className="ink-sweep flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.scheme ?? "—"}</p>
                  <p className="text-sm text-muted">
                    {s.frequency === "quarterly" ? "Quarterly" : s.frequency === "weekly" ? "Weekly" : "Monthly"}
                    {s.lastPaid ? ` · last paid ${day(s.lastPaid)}` : ` · since ${day(s.startDate)}`}
                    {s.nextDue && s.status !== "stopped" ? ` · next ${day(s.nextDue)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(s.amount)}</p>
                  <p className={`text-sm ${SIP_STATUS[s.status]?.tone ?? "text-muted"}`}>
                    {SIP_STATUS[s.status]?.label ?? s.status}
                    {s.endingSoon ? " · ending soon" : ""}
                  </p>
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
              <li key={t.id} className="ink-sweep flex items-center justify-between gap-3 px-5 py-3">
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
                  <p className="text-sm text-muted">
                    {txnType(t.type)}
                    {t.units !== null ? ` · ${t.unitsEstimated ? "≈ " : ""}${units(t.units)} u` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type FamilyInfo = NonNullable<Awaited<ReturnType<typeof clientFamily>>>;

/** Which family the client is in, with one-tap changes: join, move, leave, make head, or start a new family. */
function FamilyCard({ clientId, name, family }: { clientId: string; name: string; family: FamilyInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cur = family.current;
  const others = family.options.filter((o) => o.id !== cur?.id);

  async function change(familyId: string | null, makeHead = false) {
    setBusy(true);
    setError(null);
    const res = await setClientFamily({ data: { investorId: clientId, familyId, makeHead } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await router.invalidate();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound size={18} className="text-bronze" /> Family
          </h2>
          {cur ? (
            <p className="mt-1 text-[15px]">
              <Link to="/app/families/$familyId" params={{ familyId: cur.id }} className="link-draw font-semibold text-bronze">
                {cur.name}
              </Link>
              {cur.isHead && (
                <span className="ml-2 inline-flex items-center gap-1 text-[13px] text-bronze">
                  <Crown size={13} /> Head
                </span>
              )}
              {cur.others.length > 0 && <span className="block text-sm text-muted">With {cur.others.map((o) => o.name).join(", ")}</span>}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted">{name} isn't in a family yet.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cur && !cur.isHead && (
            <Button variant="secondary" disabled={busy} onClick={() => void change(cur.id, true)}>
              <Crown size={16} /> Make head
            </Button>
          )}
          {cur && (
            <Button variant="ghost" disabled={busy} onClick={() => void change(null)}>
              Take out of family
            </Button>
          )}
          {others.length > 0 && (
            <select
              aria-label={cur ? "Move to another family" : "Add to a family"}
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && void change(e.target.value)}
              className="min-h-11 max-w-56 rounded-full border border-line bg-field px-4 text-[15px]"
            >
              <option value="">{cur ? "Move to…" : "Add to a family…"}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          {!cur && (
            <Link to="/app/families/new" search={{ with: clientId }} className={linkButtonSecondary}>
              <Plus size={16} /> Start a family
            </Link>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

/** Emails the client the portal link; or, while the portal is off, says where to turn it on. */
function PortalCard({ clientId, name, email, portal }: { clientId: string; name: string; email: string; portal: { enabled: boolean; canManage: boolean } }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  async function send() {
    setBusy(true);
    const res = await sendPortalLink({ data: { investorId: clientId } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    setMsg(res.ok ? { tone: "good", text: `Sent to ${res.to}.` } : { tone: "error", text: res.error });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Smartphone size={18} className="text-bronze" /> Client portal
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            {!portal.enabled
              ? "Let clients see their portfolio on their phone, branded as yours."
              : email
                ? `${name} signs in with ${email}.`
                : `Add ${name}'s email to let them sign in.`}
          </p>
        </div>
        {portal.enabled && email ? (
          <Button variant="secondary" disabled={busy} onClick={() => void send()}>
            <Mail size={16} /> {busy ? "Sending…" : "Email them the link"}
          </Button>
        ) : (
          portal.canManage && (
            <Link to="/app/portal" className={linkButtonSecondary}>
              {portal.enabled ? "Portal settings" : "Set up the portal"}
            </Link>
          )
        )}
      </div>
      {msg && (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
    </Card>
  );
}
