import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Check, FileSpreadsheet, FileText, History, Lock, X } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { importClients, importOldApp, previewImport, runImport } from "@/functions/imports";
import { Button, Card, inputClass, Notice, order, PageHeader, SelectField } from "@/components/ui";
import { day, money, txnType, units as unitsText } from "@/lib/format";
import { readTables, TableError } from "@/lib/imports/tables";
import { ZipError } from "@/lib/imports/zip";
import { readFeed } from "@/lib/imports/feed";
import { casTransactions, parseCas, type CasResult } from "@/lib/imports/cas";
import type { ImportSource, ImportTxn, Skipped } from "@/lib/imports/normalise";
import { SOMETHING_WRONG } from "@/lib/errors";
import { CONSOLE_EXPORT, OldAppError, readOldTable, signInOldApp, toCsv } from "@/lib/imports/old-app";

export const Route = createFileRoute("/app/import")({
  beforeLoad: ({ context }) => {
    if (context.me.role === "subbroker") throw redirect({ to: "/app" });
  },
  loader: () => importClients(),
  head: () => ({ meta: [{ title: "Import · Anqulas Folio" }] }),
  component: ImportPage,
});

type Plan = Awaited<ReturnType<typeof previewImport>>;
type Loaded = { source: ImportSource; fileName: string; txns: ImportTxn[]; skipped: Skipped[]; cas?: CasResult };

function ImportPage() {
  const { me } = Route.useRouteContext();
  const [kind, setKind] = useState<"registrar" | "cas" | "old">("registrar");
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Registrar data"
        title="Import"
        subtitle="Bring in transactions from CAMS and KFintech reports, or from a client's CAS statement. Files are opened on this computer: their passwords never leave it."
      />
      <div role="tablist" aria-label="What to import" className="reveal inline-flex gap-1 rounded-xl bg-soft p-1" style={order(2)}>
        {(
          [
            ["registrar", "Registrar report", FileSpreadsheet],
            ["cas", "Client CAS (PDF)", FileText],
            ...(me.role === "owner" ? ([["old", "Old FundVault app", History]] as const) : []),
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[14px] font-medium transition-colors",
              kind === k ? "bg-card text-text shadow-sm" : "text-muted hover:text-text",
            )}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {kind === "registrar" ? <RegistrarImport key="r" /> : kind === "cas" ? <CasImport key="c" /> : <OldAppImport key="o" />}
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ZipError || e instanceof TableError) return e.message;
  if (e instanceof Error && e.name === "PdfPasswordError") return e.message;
  return SOMETHING_WRONG;
}

function FilePicker({
  accept,
  label,
  hint,
  onFile,
  multiple = false,
  onFiles,
}: {
  accept: string;
  label: string;
  hint: string;
  onFile: (f: File | null) => void;
  multiple?: boolean;
  onFiles?: (files: FileList | null) => void;
}) {
  return (
    <label className="block cursor-pointer rounded-2xl border border-dashed border-line bg-card/60 px-6 py-8 text-center transition-colors hover:border-bronze hover:bg-card">
      <span className="block text-[15px] font-semibold">{label}</span>
      <span className="mt-1 block text-[13px] text-muted">{hint}</span>
      <input type="file" accept={accept} className="mt-4 block w-full text-[14px] file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-fg" multiple={multiple} onChange={(e) => (onFiles ? onFiles(e.target.files) : onFile(e.target.files?.[0] ?? null))} />
    </label>
  );
}

function RegistrarImport() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  async function read() {
    if (!file) return setError("Choose the report file first.");
    setBusy(true);
    setError(null);
    setLoaded(null);
    try {
      const tables = await readTables(file.name, new Uint8Array(await file.arrayBuffer()), password || undefined);
      const txns: ImportTxn[] = [];
      const skipped: Skipped[] = [];
      let source: ImportSource = "cams";
      const missing: string[] = [];
      for (const t of tables) {
        if (!t.rows.length) continue;
        const r = readFeed(t.rows);
        if (r.missing.length) {
          missing.push(`${t.name}: no column for ${r.missing.join(", ")}`);
          continue;
        }
        source = r.source;
        txns.push(...r.txns);
        skipped.push(...r.skipped);
      }
      if (!txns.length) {
        setError(
          missing.length
            ? `This doesn't look like a transaction report. ${missing.join("; ")}. Choose a CAMS or KFintech transaction report (e.g. CAMS WBR2).`
            : "No transactions found in this file.",
        );
        return;
      }
      setLoaded({ source, fileName: file.name, txns, skipped });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <FilePicker
          accept=".zip,.dbf,.csv,.txt,.xlsx"
          label="Choose a CAMS or KFintech transaction report"
          hint="ZIP (as mailed), DBF, CSV, TXT or Excel (.xlsx). Old .xls files: save as .xlsx first."
          onFile={(f) => {
            setFile(f);
            setLoaded(null);
            setError(null);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor="zip-password" className="flex items-center gap-1.5 text-[14px] font-medium">
              <Lock size={14} /> ZIP password (if it has one)
            </label>
            <input id="zip-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </div>
          <Button onClick={() => void read()} disabled={busy || !file}>
            {busy ? "Reading…" : "Read the file"}
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>
      {loaded && <Preview loaded={loaded} />}
    </div>
  );
}

function CasImport() {
  const clients = Route.useLoaderData();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  async function read() {
    if (!file) return setError("Choose the CAS PDF first.");
    setBusy(true);
    setError(null);
    setLoaded(null);
    try {
      const { pdfLines } = await import("@/lib/imports/pdf-lines");
      const lines = await pdfLines(new Uint8Array(await file.arrayBuffer()), password || undefined);
      const cas = parseCas(lines);
      if (!cas.schemes.length) {
        setError("No folios found. Upload a detailed CAS (with transactions) from CAMS or KFintech; a summary CAS has no transactions to import.");
        return;
      }
      setLoaded({ source: "cas", fileName: file.name, txns: casTransactions(cas), skipped: [], cas });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <FilePicker
          accept=".pdf,application/pdf"
          label="Choose the client's detailed CAS (PDF)"
          hint="From CAMS or KFintech (camsonline.com / kfintech.com, 'Detailed' statement with transactions)."
          onFile={(f) => {
            setFile(f);
            setLoaded(null);
            setError(null);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cas-password" className="flex items-center gap-1.5 text-[14px] font-medium">
              <Lock size={14} /> Statement password
            </label>
            <input id="cas-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            <p className="text-[13px] text-muted">The one chosen when requesting it (often the PAN).</p>
          </div>
          <SelectField
            label="Client"
            name="client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Find by the PAN in the statement"
            options={clients.map((c) => ({ value: c.id, label: c.panLast4 ? `${c.name} (…${c.panLast4})` : c.name }))}
          />
        </div>
        <div>
          <Button onClick={() => void read()} disabled={busy || !file}>
            {busy ? "Reading…" : "Read the statement"}
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>
      {loaded?.cas && <CasSummary cas={loaded.cas} />}
      {loaded && (loaded.txns.length ? <Preview loaded={loaded} investorId={client || undefined} /> : <Notice tone="warn">No transactions in this statement could be imported.</Notice>)}
    </div>
  );
}

function CasSummary({ cas }: { cas: CasResult }) {
  return (
    <Card className="!p-0">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold">{cas.investorName ?? "Statement"}</h2>
        <p className="text-[13px] text-muted">
          {cas.period ? `${day(cas.period.from)} to ${day(cas.period.to)} · ` : ""}
          {cas.schemes.length} schemes
        </p>
      </div>
      {cas.warnings.length > 0 && (
        <div className="px-5 pb-3">
          <Notice tone="warn">
            <ul className="list-disc space-y-1 pl-4">
              {cas.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      <ul className="divide-y divide-line border-t border-line">
        {cas.schemes.map((s) => (
          <li key={`${s.folio}:${s.scheme}`} className="ink-sweep flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.scheme}</p>
              <p className="text-[13px] text-muted">
                Folio {s.folio}
                {s.advisor ? ` · ${s.advisor}` : ""} · {s.txns.length} entries
              </p>
            </div>
            <div className="text-right">
              <p className="tabular-nums">{s.value !== null ? money(s.value) : "—"}</p>
              <p className={clsx("text-[13px]", s.balanced ? "text-good" : "text-bad")}>
                {unitsText(s.close)} units {s.balanced ? "· adds up" : "· doesn't add up"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Preview({ loaded, investorId }: { loaded: Loaded; investorId?: string | undefined }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payload = { source: loaded.source, fileName: loaded.fileName, txns: loaded.txns, investorId };

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await previewImport({ data: payload }));
    } catch {
      setError(SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await runImport({ data: payload });
      setPlan(r.plan);
      setDone(r.added);
    } catch {
      setError(SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = loaded.source === "cas" ? "CAS statement" : loaded.source === "kfintech" ? "KFintech report" : "CAMS report";
  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-bronze">{sourceLabel}</p>
          <h2 className="mt-1 font-serif text-[1.75rem] leading-tight">{loaded.txns.length} transactions read</h2>
          <p className="text-[13px] text-muted">{loaded.fileName}</p>
        </div>
        {!plan && (
          <Button onClick={() => void check()} disabled={busy}>
            {busy ? "Checking…" : "Check against your clients"}
          </Button>
        )}
      </div>

      <TypeCounts txns={loaded.txns} />

      {loaded.skipped.length > 0 && (
        <details className="rounded-xl bg-soft/60 px-4 py-3 text-[14px]">
          <summary className="cursor-pointer font-medium">{loaded.skipped.length} rows left out (taxes, rejected, or details changes)</summary>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">
            {loaded.skipped.slice(0, 50).map((s, i) => (
              <li key={i}>
                <b className="font-medium text-text">{s.reason}:</b> {s.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {plan && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label={done !== null ? "Added" : "To add"} value={done ?? plan.toAdd} />
            <Figure label="Already in" value={plan.alreadyIn} />
            <Figure label="Replace typed entries" value={plan.replacesTyped} />
            <Figure label="New clients" value={plan.newClients} />
          </dl>
          {plan.from && (
            <p className="text-[14px] text-muted">
              From {day(plan.from)} to {day(plan.to)} · {plan.schemesMatched} schemes valued
              {plan.heldAway ? ` · ${plan.heldAway} entries held through another distributor` : ""}
            </p>
          )}
          {plan.replacesTyped > 0 && done === null && (
            <Notice>
              {plan.replacesTyped} entries typed here earlier match the registrar's records (same client, scheme, amount
              and date). They'll be replaced by the registrar's, which have exact units.
            </Notice>
          )}
          {plan.schemesUnmatched.length > 0 && (
            <Notice tone="warn">
              {plan.schemesUnmatched.length} scheme {plan.schemesUnmatched.length === 1 ? "name" : "names"} couldn't be matched to AMFI automatically:{" "}
              {plan.schemesUnmatched.slice(0, 5).join("; ")}
              {plan.schemesUnmatched.length > 5 ? "…" : ""}. They import anyway; match them afterwards under{" "}
              <Link to="/app/schemes" className="link-draw font-medium">
                Match schemes
              </Link>
              .
            </Notice>
          )}
          {plan.error && <Notice tone="error">{plan.error}</Notice>}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {plan.clients.slice(0, 30).map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
                <span className="min-w-0 truncate">
                  {c.name}
                  {c.panLast4 ? <span className="text-muted"> · PAN …{c.panLast4}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                  {c.entries} entries
                  {!c.investorId && <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">New client</span>}
                </span>
              </li>
            ))}
          </ul>
          {done !== null ? (
            <Notice tone="good">
              Imported {done} transactions.{" "}
              <Link to="/app/clients" className="link-draw font-medium">
                See your clients
              </Link>
              .
            </Notice>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={busy || plan.toAdd === 0 || !!plan.error}>
                {busy ? "Importing…" : plan.toAdd === 0 ? "Nothing new to import" : `Import ${plan.toAdd} transactions`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TypeCounts({ txns }: { txns: ImportTxn[] }) {
  const counts = new Map<string, { n: number; amount: number }>();
  for (const t of txns) {
    const c = counts.get(t.type) ?? { n: 0, amount: 0 };
    c.n++;
    c.amount += t.amount;
    counts.set(t.type, c);
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {[...counts].map(([type, c]) => (
        <li key={type} className="rounded-full border border-line px-3 py-1 text-[13px]">
          {txnType(type)} · {c.n} · {money(c.amount)}
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-soft/60 px-4 py-3">
      <dt className="eyebrow text-muted">{label}</dt>
      <dd className="mt-1 font-serif text-[1.75rem] leading-none">{value}</dd>
    </div>
  );
}

// ── The old FundVault app ─────────────────────────────────────────────────────

type OldFiles = { clients?: { name: string; text: string }; investments?: { name: string; text: string }; sips?: { name: string; text: string } };
type OldResult = Awaited<ReturnType<typeof importOldApp>>;

/** Which table a CSV export is, by its columns (file names from the export vary). */
function tableOf(text: string): keyof OldFiles | null {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]!.toLowerCase().split(",").map((h) => h.replace(/"/g, "").trim());
  if (header.includes("client_id") && header.includes("start_date")) return "sips";
  if (header.includes("client_id") && header.includes("date")) return "investments";
  if (header.includes("name") && (header.includes("pan") || header.includes("mobile"))) return "clients";
  return null;
}

function OldAppImport() {
  const [files, setFiles] = useState<OldFiles>({});
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OldResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(list: FileList | null) {
    setResult(null);
    setSaved(false);
    setError(null);
    const next: OldFiles = { ...files };
    const odd: string[] = [];
    for (const f of Array.from(list ?? [])) {
      const text = await f.text();
      const t = tableOf(text);
      if (t) next[t] = { name: f.name, text };
      else odd.push(f.name);
    }
    setFiles(next);
    setUnknown(odd);
  }

  async function run(dryRun: boolean) {
    if (!files.clients) return setError("Choose at least the clients file.");
    setBusy(true);
    setError(null);
    try {
      const r = await importOldApp({ data: { clients: files.clients.text, investments: files.investments?.text ?? "", sips: files.sips?.text ?? "", dryRun } });
      if (!r.ok) setError(r.error);
      else {
        setResult(r);
        setSaved(!dryRun);
      }
    } catch {
      setError(SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  const [oldEmail, setOldEmail] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [copied, setCopied] = useState(false);

  /** Straight from the old app's database, with his old-app sign-in. */
  async function fetchFromOldApp() {
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(false);
    try {
      const token = await signInOldApp(oldEmail, oldPassword);
      const [c, i, sp] = await Promise.all([readOldTable("clients", token), readOldTable("investments", token), readOldTable("sips", token)]);
      if (!c.length) {
        setError("The old app returned no clients for this account. Is it the account the data was entered with?");
        return;
      }
      const label = "from the old app";
      setFiles({ clients: { name: `${c.length} rows ${label}`, text: toCsv(c) }, investments: { name: `${i.length} rows ${label}`, text: toCsv(i) }, sips: { name: `${sp.length} rows ${label}`, text: toCsv(sp) } });
      setUnknown([]);
      setOldPassword("");
    } catch (e) {
      setError(e instanceof OldAppError ? e.message : "Couldn't reach the old app. Check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const slots: [keyof OldFiles, string][] = [
    ["clients", "Clients"],
    ["investments", "Investments"],
    ["sips", "SIPs"],
  ];
  const report = result?.ok ? result.report : null;
  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div>
          <h2 className="text-[17px] font-semibold">Bring over the old FundVault app's data</h2>
          <p className="mt-1 text-[14px] text-muted">
            Nothing is saved until you press Import, and running it again never doubles anything. The old app isn't changed.
          </p>
        </div>
        <div className="space-y-3 rounded-xl bg-soft/60 p-4">
          <p className="text-[15px] font-semibold">Easiest: sign in to the old app here</p>
          <p className="text-[13px] text-muted">
            With the email and password used in the old FundVault app. This browser reads his data from the old app directly; the password isn't kept.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="old-email" className="block text-[14px] font-medium">
                Old app email
              </label>
              <input id="old-email" type="email" autoComplete="off" value={oldEmail} onChange={(e) => setOldEmail(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="old-password" className="block text-[14px] font-medium">
                Old app password
              </label>
              <input id="old-password" type="password" autoComplete="off" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className={inputClass} />
            </div>
            <Button disabled={busy || !oldEmail || !oldPassword} onClick={() => void fetchFromOldApp()}>
              {busy ? "Reading…" : "Get his data"}
            </Button>
          </div>
          <details className="text-[13px] text-muted">
            <summary className="cursor-pointer font-medium text-text">He signs in to the old app with Google?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>On a computer, open the old FundVault app and sign in as usual.</li>
              <li>
                Copy this export script:{" "}
                <button
                  type="button"
                  className="link-draw font-medium text-bronze"
                  onClick={() =>
                    void navigator.clipboard.writeText(CONSOLE_EXPORT).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    })
                  }
                >
                  {copied ? "Copied" : "Copy export script"}
                </button>
                . It only reads his data and downloads it.
              </li>
              <li>On the old app's page press F12 (or right-click → Inspect), open Console, paste and press Enter. If the browser asks, type "allow pasting" first.</li>
              <li>Three files download: clients.csv, investments.csv, sips.csv. Choose them below.</li>
            </ol>
          </details>
        </div>
        <p className="text-center text-[13px] text-muted">or</p>
        <FilePicker accept=".csv,text/csv" label="Choose the three CSV files" hint="Select them together, or one at a time." onFile={() => {}} multiple onFiles={(l) => void choose(l)} />
        <ul className="grid gap-2 sm:grid-cols-3">
          {slots.map(([k, label]) => (
            <li key={k} className={clsx("flex items-center gap-2 rounded-xl px-3 py-2 text-[14px]", files[k] ? "bg-good-soft text-good" : "bg-soft text-muted")}>
              {files[k] ? <Check size={16} /> : <X size={16} />}
              <span className="min-w-0 truncate">
                <b className="font-medium">{label}</b> {files[k] ? `· ${files[k]!.name}` : "· not chosen"}
              </span>
            </li>
          ))}
        </ul>
        {unknown.length > 0 && <Notice tone="warn">Not a clients, investments or SIPs export: {unknown.join(", ")}.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {!saved && (
          <div className="flex flex-wrap gap-2">
            <Button variant={report ? "secondary" : "primary"} disabled={busy || !files.clients} onClick={() => void run(true)}>
              {busy && !report ? "Checking…" : "Check (saves nothing)"}
            </Button>
            {report && (
              <Button disabled={busy} onClick={() => void run(false)}>
                {busy ? "Importing…" : "Import into Folio"}
              </Button>
            )}
          </div>
        )}
      </Card>

      {report && result?.ok && (
        <Card className="space-y-4">
          <div>
            <p className="eyebrow text-bronze">{saved ? "Imported" : "What will be imported"}</p>
            <h2 className="mt-1 font-serif text-[1.75rem] leading-tight">
              {report.clients.imported} clients, {report.investments.imported} investments, {report.sips.imported} SIPs
            </h2>
            {report.clients.skippedSamples > 0 && <p className="text-[13px] text-muted">
                The old app's {report.clients.skippedSamples === 1 ? "built-in sample client is" : `${report.clients.skippedSamples} built-in sample clients are`} left out.
              </p>}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Compare label="Total invested" before={money(report.totals.oldInvested)} after={money(report.totals.newInvested)} same={Math.abs(report.totals.oldInvested - report.totals.newInvested) < 0.01} />
            <Compare label="Active SIPs" before={String(report.totals.oldActiveSips)} after={String(report.totals.newActiveSips)} same={report.totals.oldActiveSips === report.totals.newActiveSips} />
          </dl>
          {result.totalsMatch ? (
            <Notice tone="good">The totals match the old app.</Notice>
          ) : (
            <Notice tone="warn">The totals differ from the old app. Check the rows below before relying on the data.</Notice>
          )}
          {[...report.investments.skipped, ...report.sips.skipped].length > 0 && (
            <details className="rounded-xl bg-soft/60 px-4 py-3 text-[14px]">
              <summary className="cursor-pointer font-medium">{report.investments.skipped.length + report.sips.skipped.length} rows left out</summary>
              <ul className="mt-2 space-y-1 text-[13px] text-muted">
                {[...report.investments.skipped, ...report.sips.skipped].slice(0, 50).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          {saved && (
            <Notice tone="good">
              Done. Scheme names that exactly match an AMFI scheme were linked, so their value shows now; match the rest under{" "}
              <Link to="/app/schemes" className="link-draw font-medium">
                Match schemes
              </Link>
              . Then import his CAMS and KFintech reports: their exact records replace the typed entries.{" "}
              <Link to="/app/clients" className="link-draw font-medium">
                See the clients
              </Link>
              .
            </Notice>
          )}
        </Card>
      )}
    </div>
  );
}

function Compare({ label, before, after, same }: { label: string; before: string; after: string; same: boolean }) {
  return (
    <div className="rounded-xl bg-soft/60 px-4 py-3">
      <dt className="eyebrow text-muted">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[15px]">
        <span>
          Old app <b className="font-serif text-[1.375rem] font-normal">{before}</b>
        </span>
        <span>
          Folio <b className="font-serif text-[1.375rem] font-normal">{after}</b>
        </span>
        <span className={same ? "text-good" : "text-bad"}>{same ? "same" : "differs"}</span>
      </dd>
    </div>
  );
}
