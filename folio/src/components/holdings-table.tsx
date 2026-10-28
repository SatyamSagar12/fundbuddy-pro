import type { ReactNode } from "react";
import { day, gainTone, money, navText, percent, units } from "@/lib/format";
import { shownReturn } from "@/lib/holdings";

export type HoldingLine = {
  investorId: string;
  instrumentId: string;
  name: string;
  units: number;
  cost: number;
  value: number | null;
  gain: number | null;
  xirr: number | null;
  absoluteReturn: number | null;
  firstDate: string | null;
  nav: number | null;
  navDate: string | null;
  estimated: boolean;
  /** Whose holding it is, on a family's page. */
  member?: string;
};

/**
 * Holdings with units, cost, value and gain. Schemes not matched to AMFI yet are listed at their invested
 * amount; `unmatchedNote` says what to do about them (a link for the team, nothing for a client).
 */
export function HoldingsTable({
  holdings,
  unmatched,
  unmatchedNote,
}: {
  holdings: readonly HoldingLine[];
  unmatched: readonly { scheme: string; netInvested: number }[];
  unmatchedNote?: ReactNode;
}) {
  if (holdings.length === 0 && unmatched.length === 0) return <p className="px-5 pb-5 text-muted">No holdings yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[15px]">
        <thead>
          <tr className="eyebrow border-b border-line text-left text-muted">
            <th className="px-5 py-2">Scheme</th>
            <th className="px-3 py-2 text-right">Units</th>
            <th className="px-3 py-2 text-right">Invested</th>
            <th className="px-3 py-2 text-right">Value</th>
            <th className="px-5 py-2 text-right">Gain</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {holdings.map((h) => {
            const r = shownReturn(h);
            return (
              <tr key={`${h.investorId}:${h.instrumentId}`}>
                <td className="px-5 py-3">
                  <p className="font-semibold leading-snug">{h.name}</p>
                  <p className="text-[13px] text-muted">
                    {h.member ? `${h.member} · ` : ""}NAV {navText(h.nav)} · {day(h.navDate)}
                    {h.estimated ? " · units estimated from NAV" : ""}
                  </p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{units(h.units)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(h.cost)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">{h.value === null ? "—" : money(h.value)}</td>
                <td className={`px-5 py-3 text-right tabular-nums ${gainTone(h.gain)}`}>
                  {h.gain === null ? "—" : money(h.gain)}
                  <p className="text-[13px]">
                    {r.label} {percent(r.value)}
                  </p>
                </td>
              </tr>
            );
          })}
          {unmatched.map((u) => (
            <tr key={`u:${u.scheme}`}>
              <td className="px-5 py-3">
                <p className="font-semibold leading-snug">{u.scheme}</p>
                {unmatchedNote}
              </td>
              <td className="px-3 py-3 text-right text-muted">—</td>
              <td className="px-3 py-3 text-right tabular-nums">{money(u.netInvested)}</td>
              <td className="px-3 py-3 text-right text-muted">—</td>
              <td className="px-5 py-3 text-right text-muted">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The four figures at the top of a client's or a family's page. */
export function SummaryTiles({ tiles }: { tiles: readonly { k: string; v: string; sub?: string; tone?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.k} className="reveal rounded-2xl bg-card p-5 shadow-sm ring-1 ring-line">
          <p className="eyebrow text-muted">{x.k}</p>
          <p className={`mt-2 font-serif text-[1.875rem] leading-none tracking-[-0.02em] ${x.tone ?? ""}`}>{x.v}</p>
          {x.sub && <p className="text-[13px] text-muted">{x.sub}</p>}
        </div>
      ))}
    </div>
  );
}
