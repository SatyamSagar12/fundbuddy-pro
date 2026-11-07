import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { getPortalHome, portalSignOut } from "@/functions/portal";
import { PortalFrame } from "@/components/portal-frame";
import { SummaryTiles } from "@/components/holdings-table";
import { StatementButton } from "@/components/statement-button";
import { Card, order } from "@/components/ui";
import { day, gainTone, money, percent, txnType, units } from "@/lib/format";

/** A client's own (and their family's) portfolio, read-only, branded as their distributor's. */
export const Route = createFileRoute("/portal")({
  loader: () => getPortalHome(),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.title} · ${loaderData.practice.name}` : "Your portfolio" }] }),
  component: PortalHome,
});

function PortalHome() {
  const d = Route.useLoaderData();
  const navigate = useNavigate();
  const [allTxns, setAllTxns] = useState(false);

  if (!d) {
    return (
      <PortalFrame practice={null}>
        <Card className="mx-auto max-w-md">
          <h1 className="text-[2rem]">You're signed out</h1>
          <p className="mt-3 text-muted">Open the link your mutual fund distributor sent you to sign in again.</p>
        </Card>
      </PortalFrame>
    );
  }

  const signOut = async () => {
    await portalSignOut();
    await navigate(d.code ? { to: "/c/$code", params: { code: d.code } } : { to: "/portal" });
  };
  const byMember = new Map<string, number>();
  for (const h of d.holdings) byMember.set(h.member, (byMember.get(h.member) ?? 0) + (h.value ?? 0));
  const txns = allTxns ? d.transactions : d.transactions.slice(0, 12);

  return (
    <PortalFrame
      practice={d.practice}
      action={
        <button onClick={() => void signOut()} className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[14px] text-[#a9b0a5] hover:bg-white/10 hover:text-bone">
          <LogOut size={16} /> Sign out
        </button>
      }
    >
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div className="min-w-0">
            <p className="eyebrow reveal mb-3 text-bronze">{d.isFamily ? "Family portfolio" : "Your portfolio"}</p>
            <h1 className="text-[2.25rem] sm:text-[2.875rem]">
              <span className="line-mask">
                <span>{d.title}</span>
              </span>
            </h1>
            <p className="reveal mt-3 text-[15px] text-muted" style={order(1)}>
              {d.navDate ? `Values at the NAV of ${day(d.navDate)}` : "Values appear once the day's NAVs are in"} · {d.email}
            </p>
          </div>
          <div className="reveal" style={order(2)}>
            <StatementButton load={() => getPortalHome()} variant="primary" />
          </div>
        </header>

        <SummaryTiles
          tiles={[
            { k: "Current value", v: money(d.total.value) },
            { k: "Invested", v: money(d.total.invested) },
            { k: "Gain", v: money(d.total.gain), tone: gainTone(d.total.gain) },
            { k: d.total.returnLabel === "XIRR" ? "XIRR (yearly)" : "Return", v: percent(d.total.returnValue) },
          ]}
        />

        {d.isFamily && (
          <Card className="!p-0">
            <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Family</h2>
            <ul className="divide-y divide-line">
              {d.people.map((name, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="font-medium">{name}</span>
                  <span className="font-semibold tabular-nums">{money(byMember.get(name) ?? 0)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="!p-0">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Holdings</h2>
          {d.holdings.length === 0 && d.notValued.length === 0 ? (
            <p className="px-5 pb-5 text-muted">No holdings yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.holdings.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{h.scheme}</p>
                    <p className="text-[13px] text-muted">
                      {d.isFamily ? `${h.member} · ` : ""}
                      {h.estimated ? "≈ " : ""}
                      {units(h.units)} units · invested {money(h.invested)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">{h.value === null ? "—" : money(h.value)}</p>
                    <p className={`text-[13px] tabular-nums ${gainTone(h.gain)}`}>
                      {h.gain === null ? "" : money(h.gain)} · {percent(h.returnValue)}
                    </p>
                  </div>
                </li>
              ))}
              {d.notValued.map((u) => (
                <li key={u.scheme} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{u.scheme}</p>
                    <p className="text-[13px] text-muted">Value coming soon · invested {money(u.invested)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="!p-0">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">SIPs</h2>
          {d.sips.length === 0 ? (
            <p className="px-5 pb-5 text-muted">No SIPs.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.sips.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{s.scheme}</p>
                    <p className="text-[13px] text-muted">
                      {d.isFamily ? `${s.member} · ` : ""}
                      {s.frequency === "quarterly" ? "Every quarter" : "Every month"} since {day(s.since)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">{money(s.amount)}</p>
                    <p className={`text-[13px] ${s.status === "active" ? "text-good" : "text-muted"}`}>{s.status === "active" ? "Active" : "Paused"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="!p-0">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Last 12 months</h2>
          {d.transactions.length === 0 ? (
            <p className="px-5 pb-5 text-muted">No transactions in the last 12 months.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {txns.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.scheme}</p>
                      <p className="text-[13px] text-muted">
                        {day(t.date)} · {txnType(t.type)}
                        {d.isFamily ? ` · ${t.member}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{money(t.amount)}</p>
                  </li>
                ))}
              </ul>
              {d.transactions.length > txns.length && (
                <button onClick={() => setAllTxns(true)} className="link-draw mx-5 my-4 font-medium text-bronze">
                  Show all {d.transactions.length}
                </button>
              )}
            </>
          )}
        </Card>

        <p className="text-[13px] leading-relaxed text-muted">
          Values use the latest NAV published by AMFI and are for information; your fund house's account statement is the official record. To buy,
          sell or change a SIP, talk to {d.practice.name}.
        </p>
      </div>
    </PortalFrame>
  );
}
