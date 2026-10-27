import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { findSchemes, listUnmatched, matchSchemes } from "@/functions/schemes";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { money, navText } from "@/lib/format";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/schemes")({
  loader: () => listUnmatched(),
  head: () => ({ meta: [{ title: "Match schemes · Anqulas Folio" }] }),
  component: MatchSchemesPage,
});

type Data = Awaited<ReturnType<typeof listUnmatched>>;
type Row = Data["rows"][number];
type Hit = Row["hits"][number];

function MatchSchemesPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sure = data.rows.filter((r) => r.confident);

  async function apply(matches: { scheme: string; instrumentId: string }[]) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await matchSchemes({ data: { matches } });
      setMsg({
        tone: "good",
        text: `Matched ${matches.length} ${matches.length === 1 ? "scheme" : "schemes"} (${res.entries} entries, ${res.sips} SIPs). Units and values are worked out from each scheme's NAVs.`,
      });
      await router.invalidate();
    } catch {
      setMsg({ tone: "error", text: SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Match schemes"
        subtitle="Link each scheme name to its AMFI scheme, so the app knows the units and the current value."
        action={
          sure.length > 0 ? (
            <Button disabled={busy} onClick={() => void apply(sure.map((r) => ({ scheme: r.scheme, instrumentId: r.confident! })))}>
              Use all {sure.length} exact matches
            </Button>
          ) : undefined
        }
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {data.schemesLoaded === 0 && (
        <Notice>
          The AMFI scheme list hasn't loaded yet. It loads by itself a few minutes after the app is first opened each
          day; come back shortly.
        </Notice>
      )}
      {data.rows.length === 0 ? (
        <Card>
          <p className="text-center text-muted">
            Every scheme is matched. <Link to="/app" className="font-semibold text-bronze underline">Back to Home</Link>
          </p>
        </Card>
      ) : (
        <>
          {data.total > data.rows.length && (
            <p className="text-sm text-muted">
              Showing the {data.rows.length} largest of {data.total}. More appear as you match these.
            </p>
          )}
          <div className="space-y-3">
            {data.rows.map((r) => (
              <MatchRow key={r.scheme} row={r} busy={busy} onMatch={(id) => void apply([{ scheme: r.scheme, instrumentId: id }])} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MatchRow({ row, busy, onMatch }: { row: Row; busy: boolean; onMatch: (instrumentId: string) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[] | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 3) {
      setFound(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      findSchemes({ data: { q } })
        .then((r) => n === seq.current && setFound(r))
        .catch(() => n === seq.current && setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hits = found ?? row.hits;
  const uses = [row.entries ? `${row.entries} ${row.entries === 1 ? "entry" : "entries"}` : null, row.sips ? `${row.sips} SIP${row.sips === 1 ? "" : "s"}` : null, row.amount ? money(row.amount) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="!p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{row.scheme}</h2>
        <p className="text-sm text-muted">{uses}</p>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {hits.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted">{found ? "Nothing found. Try other words." : "No close match. Search below."}</li>
        ) : (
          hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug">
                  {h.name}
                  {!found && row.confident === h.id && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-[12px] font-semibold text-good">Exact</span>}
                </p>
                <p className="text-[13px] text-muted">{[h.category, h.nav !== null ? `NAV ${navText(h.nav)}` : null].filter(Boolean).join(" · ")}</p>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onMatch(h.id)}>
                Use this
              </Button>
            </li>
          ))
        )}
      </ul>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={`Search schemes for ${row.scheme}`}
        placeholder="Search other schemes…"
        className="mt-3 block min-h-11 w-full rounded-lg border border-line bg-white px-3.5 text-[16px] outline-none focus:border-bronze"
      />
    </Card>
  );
}
