import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getBilling, submitUtr, upiRequest } from "@/functions/billing";
import { Button, Card, Field, Notice } from "@/components/ui";
import { PLANS, PLAN_IDS, type Months, type PlanId } from "@/lib/plans";
import { day, money } from "@/lib/format";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/settings/billing")({
  loader: () => getBilling(),
  component: BillingPage,
});

const STATE_TEXT = {
  exempt: () => "Founder account: no payment needed.",
  trial: (d: string) => `Free trial until ${d}.`,
  active: (d: string) => `Paid until ${d}.`,
  grace: (d: string) => `Your plan has ended. The app keeps working until ${d}; pay to continue.`,
  locked: () => "Your plan has ended. Your data is safe; pay to open the app again.",
};

function BillingPage() {
  const b = Route.useLoaderData();
  const router = useRouter();
  const [months, setMonths] = useState<Months>(12);
  const [chosen, setChosen] = useState<PlanId | null>(null);
  const [upi, setUpi] = useState<{ url: string; qrSvg: string; amount: number; upiId: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const when = b.state === "grace" ? day(b.locksAt) : day(b.endsAt);

  async function choose(plan: PlanId) {
    setMsg(null);
    setBusy(true);
    const res = await upiRequest({ data: { plan, months } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    if (res.ok) {
      setChosen(plan);
      setUpi(res);
    } else setMsg({ tone: "error", text: res.error });
  }

  async function onUtr(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chosen) return;
    const utr = String(new FormData(e.currentTarget).get("utr") ?? "").replace(/\s/g, "");
    setBusy(true);
    setMsg(null);
    try {
      const res = await submitUtr({ data: { plan: chosen, months, utr } });
      if (res.ok) {
        setMsg({ tone: "good", text: "Thank you. We'll check the payment and confirm it, usually within a few hours." });
        setUpi(null);
        setChosen(null);
        await router.invalidate();
      } else setMsg({ tone: "error", text: res.error });
    } catch (err) {
      setMsg({ tone: "error", text: firstIssue(err) ?? SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card>
        <h2 className="text-lg font-semibold">Your plan: {b.state === "trial" ? `Trial (${b.limitsName} limits)` : (b.plan ? PLANS[b.plan as PlanId].name : b.limitsName)}</h2>
        <p className="mt-1 text-[15px]" data-testid="billing-state">
          {STATE_TEXT[b.state](when)}
        </p>
        <p className="mt-3 text-sm text-muted">
          Clients {b.usage.clients} of {b.usage.clientLimit ?? "unlimited"} · Team {b.usage.seats} of {b.usage.seatLimit}
        </p>
      </Card>

      {b.state !== "exempt" && (
        <Card>
          {b.pending ? (
            <p className="text-[15px]">A payment is waiting to be checked. We'll confirm it soon; nothing else is needed.</p>
          ) : upi && chosen ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                Pay {money(upi.amount)} for {PLANS[chosen].name}, {months === 12 ? "1 year" : "1 month"}
              </h2>
              <div className="flex flex-wrap items-start gap-5">
                {/* The SVG is generated on our server from our own UPI ID and amount. */}
                <div className="w-[220px] shrink-0 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: upi.qrSvg }} />
                <ol className="list-decimal space-y-2 pl-5 text-[15px]">
                  <li>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM), or on this phone tap <a className="font-semibold text-bronze underline" href={upi.url}>Pay with a UPI app</a>.</li>
                  <li>
                    Check it shows <b>{upi.upiId}</b> and <b>{money(upi.amount)}</b>.
                  </li>
                  <li>After paying, open the payment's details and copy the 12-digit <b>UTR</b> (also called UPI reference).</li>
                </ol>
              </div>
              <form method="post" onSubmit={onUtr} className="space-y-4">
                <Field label="UTR (12 digits)" name="utr" inputMode="numeric" autoComplete="off" maxLength={14} required />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Sending…" : "I've paid"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setUpi(null)}>
                    Choose another plan
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{b.state === "active" ? "Renew or change plan" : "Choose a plan"}</h2>
                <div className="flex rounded-lg border border-line p-0.5 text-sm font-semibold" role="radiogroup" aria-label="Billing period">
                  {([12, 1] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={months === m}
                      onClick={() => setMonths(m)}
                      className={`rounded-md px-3 py-1.5 ${months === m ? "bg-ink text-paper" : "text-muted"}`}
                    >
                      {m === 12 ? "Yearly" : "Monthly"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {PLAN_IDS.map((id) => {
                  const p = PLANS[id];
                  return (
                    <div key={id} className="flex flex-col rounded-xl border border-line bg-white p-4">
                      <p className="font-semibold">{p.name}</p>
                      <p className="mt-1 text-[22px] font-semibold">
                        {money(p.inr[months])}
                        <span className="text-sm font-normal text-muted">/{months === 12 ? "year" : "month"}</span>
                      </p>
                      <p className="mt-2 flex-1 text-sm text-muted">
                        {p.clients ? `Up to ${p.clients} clients` : "Unlimited clients"} · {p.users} {p.users > 1 ? "people" : "person"}
                      </p>
                      <Button className="mt-3" variant={id === "growth" ? "primary" : "secondary"} disabled={busy || !b.upiReady} onClick={() => void choose(id)}>
                        Choose {p.name}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {!b.upiReady && <p className="text-sm text-muted">Payments aren't switched on yet.</p>}
              <p className="text-sm text-muted">
                Yearly costs 10 months' price: 2 months free. Paying during the trial keeps your remaining trial days.
                Nothing renews automatically.
              </p>
            </div>
          )}
        </Card>
      )}

      {b.history.length > 0 && (
        <Card className="!p-0">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Payments</h2>
          <ul className="divide-y divide-line">
            {b.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                <span>
                  {day(h.createdAt)} · {PLANS[h.plan as PlanId]?.name ?? h.plan}, {h.months === 12 ? "1 year" : "1 month"}
                  {h.reference && <span className="text-muted"> · UTR {h.reference}</span>}
                </span>
                <span className="font-semibold">
                  {money(h.amountMinor / 100)} · {h.status === "pending" ? "being checked" : h.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
