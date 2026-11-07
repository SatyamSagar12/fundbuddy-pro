import { Button } from "./ui";

/** Shows recovery codes once, with copy and download. */
export function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const text = `Anqulas Folio recovery codes\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-4">
      <p className="text-[15px]">
        If you lose your phone, one of these codes gets you back in. <b>Save them now</b>: write them down or download
        them, and keep them away from your phone. You won't see them again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-field p-4 font-mono text-[15px] font-semibold tracking-wider" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = Object.assign(document.createElement("a"), { href: url, download: "anqulas-folio-recovery-codes.txt" });
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download
        </Button>
        <Button type="button" variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy
        </Button>
      </div>
      <Button type="button" className="w-full" onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
