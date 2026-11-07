import { useEffect, useState } from "react";
import { FileDown, Share2 } from "lucide-react";
import { Button } from "./ui";
import { statementFileName, type StatementData } from "@/lib/statement";
import { SOMETHING_WRONG } from "@/lib/errors";

/** True on a phone or tablet that can hand a PDF to other apps (WhatsApp, mail). Computers download it instead. */
function canShareFiles(): boolean {
  try {
    if (!window.matchMedia("(pointer: coarse)").matches) return false;
    const probe = new File([new Uint8Array(1)], "x.pdf", { type: "application/pdf" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Makes the branded statement PDF in the browser. pdf-lib is loaded only on the first press. On a phone the PDF goes
 * to the share sheet (WhatsApp, mail); elsewhere it downloads.
 */
export function StatementButton({ load, variant = "secondary" }: { load: () => Promise<StatementData | null>; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  useEffect(() => setShare(canShareFiles()), []);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const [{ statementPdf }, data] = await Promise.all([import("@/lib/statement-pdf"), load()]);
      if (!data) throw new Error("not found");
      const bytes = await statementPdf(data);
      const name = statementFileName(data);
      const file = new File([bytes as BlobPart], name, { type: "application/pdf" });
      if (share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${data.title}: portfolio statement` });
        } catch (e) {
          // Closing the share sheet isn't a failure.
          if ((e as Error).name !== "AbortError") throw e;
        }
      } else {
        const url = URL.createObjectURL(file);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch {
      setError(SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <Button variant={variant} onClick={() => void make()} disabled={busy}>
        {share ? <Share2 size={16} /> : <FileDown size={16} />} {busy ? "Making PDF…" : share ? "Share PDF" : "PDF statement"}
      </Button>
      {error && (
        <span role="alert" className="mt-1 text-[13px] text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
