import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  approveUser,
  decidePayment,
  extendTrial,
  getPlatform,
  importNavsNow,
  recordPayment,
  resetUserAuthenticator,
  setBillingExempt,
  setPracticeStatus,
} from "@/functions/platform";
import { Button, Card, Field, Notice } from "@/components/ui";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/plans";
import { day, money } from "@/lib/format";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/platform")({
  loader: () => getPlatform(),
  head: () => ({ meta: [{ title: "Platform · Anqulas Folio" }] }),
  component: PlatformPage,
});

const STATE: Record<string, string> = { exempt: "Free", trial: "Trial", active: "Paid", grace: "Grace", locked: "Locked" };

function PlatformPage() {
  const d = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await action();
      setMsg(res.ok ? { tone: "good", text: success } : { tone: "error", text: res.error ?? SOMETHING_WRONG });
      await router.invalidate();
    } catch (err) {
      setMsg({ tone: "error", text: firstIssue(err) ?? SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8">
      <header>
        <p className="eyebrow reveal text-bronze">Anqulas Folio · Platform console</p>
        <h1 className="text-[2.25rem] sm:text-[2.875rem]"><span className="line-mask"><span>Platform</span></span></h1>
      </header>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Practices", String(d.totals.practices)],
          ["Monthly revenue", money(d.totals.mrr)],
          ["People", String(d.totals.users)],
          ["Clients", String(d.totals.clients)],
        ].map(([k, v]) => (
          <Card key={k} className="!p-5">
            <p className="eyebrow text-muted">{k}</p>
            <p className="mt-2 font-serif text-[2rem] leading-none tracking-[-0.02em]">{v}</p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted">
        {Object.entries(d.totals.byState)
          .map(([s, n]) => `${STATE[s] ?? s}: ${n}`)
          .join(" · ") || "No practices yet"}
      </p>

      {!d.emailReady && (
        <Notice tone="info">
          No email service is set up yet, so sign-ups can't confirm their email and no emails are sent. Approve new
          accounts below.
        </Notice>
      )}
      {d.unconfirmed.length > 0 && (
        <Card className="!p-0">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Sign-ups waiting ({d.unconfirmed.length})</h2>
          <ul className="divide-y divide-line">
            {d.unconfirmed.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{u.name}</p>
                  <p className="truncate text-sm text-muted">
                    {u.email} · signed up {day(u.createdAt)}
                  </p>
                </div>
                <Button disabled={busy} onClick={() => void run(() => approveUser({ data: { userId: u.id } }), `${u.email} approved.`)}>
                  Approve
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">NAV data (AMFI)</h2>
          <p className="text-[15px] text-muted">
            {d.nav.schemes.toLocaleString("en-IN")} schemes · {d.nav.tracked} with history ·{" "}
            {d.nav.lastImport ? `NAV date ${d.nav.lastImport.navDate ?? "—"}, imported ${new Date(d.nav.lastImport.at).toLocaleString("en-IN")}` : "never imported"}
            {d.nav.pendingUnits ? ` · ${d.nav.pendingUnits} entries waiting for units` : ""}
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => importNavsNow(), "NAVs imported.")}>
          Import NAVs now
        </Button>
      </Card>

      <Card className="!p-0">
        <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">UPI payments to check ({d.pending.length})</h2>
        {d.pending.length === 0 ? (
          <p className="px-5 pb-5 text-muted">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {d.pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="font-semibold">
                    {money(p.amountMinor / 100)} · UTR <span className="font-mono">{p.reference}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {p.practiceName} · {PLANS[p.plan as PlanId]?.name}, {p.months === 12 ? "1 year" : "1 month"} · {day(p.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={() => void run(() => decidePayment({ data: { id: p.id, decision: "confirm" } }), "Payment confirmed; plan extended.")}>
                    Received, confirm
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => decidePayment({ data: { id: p.id, decision: "reject" } }), "Payment rejected; the owner was told.")}>
                    Not received
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="!p-0">
        <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Practices</h2>
        <ul className="divide-y divide-line">
          {d.practices.map((p) => (
            <li key={p.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {p.name} {p.status === "suspended" && <span className="text-bad">(suspended)</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {p.ownerEmail ?? "no owner"} · {STATE[p.state]} {p.endsAt ? `until ${day(p.endsAt)}` : ""} · {p.clients} clients · {p.members} {p.members === 1 ? "person" : "people"}
                    {p.arn ? ` · ${p.arn}` : ""} · since {day(p.createdAt)}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? "Close" : "Manage"}
                </Button>
              </div>
              {open === p.id && (
                <div className="mt-3 flex flex-wrap gap-4 rounded-lg bg-paper p-4">
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const days = Number(new FormData(e.currentTarget).get("days"));
                      void run(() => extendTrial({ data: { practiceId: p.id, days } }), `Trial extended by ${days} days.`);
                    }}
                  >
                    <label className="text-sm font-semibold">
                      Extend trial (days)
                      <input name="days" type="number" min={1} max={90} defaultValue={14} className="mt-1 block min-h-10 w-24 rounded-lg border border-line bg-field px-2" />
                    </label>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Extend
                    </Button>
                  </form>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const plan = String(f.get("plan")) as PlanId;
                      const months = Number(f.get("months")) === 12 ? 12 : 1;
                      void run(
                        () => recordPayment({ data: { practiceId: p.id, plan, months, note: String(f.get("note") ?? "") } }),
                        "Payment recorded; plan extended.",
                      );
                    }}
                  >
                    <label className="text-sm font-semibold">
                      Paid outside the app
                      <select name="plan" className="mt-1 block min-h-10 rounded-lg border border-line bg-field px-2">
                        {PLAN_IDS.map((id) => (
                          <option key={id} value={id}>
                            {PLANS[id].name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <select name="months" aria-label="Period" className="min-h-10 rounded-lg border border-line bg-field px-2">
                      <option value="1">1 month</option>
                      <option value="12">1 year</option>
                    </select>
                    <input name="note" placeholder="Note (e.g. bank transfer ref)" className="min-h-10 rounded-lg border border-line bg-field px-2" />
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Record
                    </Button>
                  </form>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const next = p.status === "suspended" ? "active" : "suspended";
                      if (next === "suspended" && !confirm(`Suspend ${p.name}? Everyone in it is signed out at once.`)) return;
                      void run(() => setPracticeStatus({ data: { practiceId: p.id, status: next } }), next === "suspended" ? "Suspended." : "Restored.");
                    }}
                  >
                    {p.status === "suspended" ? "Restore" : "Suspend"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setBillingExempt({ data: { practiceId: p.id, exempt: !p.billingExempt } }),
                        p.billingExempt ? "Billing turned back on." : `${p.name} is now free of charge.`,
                      )
                    }
                  >
                    {p.billingExempt ? "Charge again" : "Make free of charge"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Reset someone's authenticator</h2>
        <p className="mt-1 mb-4 text-[15px] text-muted">
          Only for someone who lost their phone and their recovery codes. Check it's really them first: call a number
          you already know, not one given in their email.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email") ?? "");
            if (!confirm(`Remove the authenticator from ${email}?`)) return;
            void run(() => resetUserAuthenticator({ data: { email } }), "Authenticator removed. They can sign in with their password and set up a new one.");
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Their email" name="email" type="email" required />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Reset authenticator
          </Button>
        </form>
      </Card>
    </main>
  );
}
