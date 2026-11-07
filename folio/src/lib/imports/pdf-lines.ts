/**
 * Text lines from a PDF, for the CAS reader. Runs in the browser with pdf.js (loaded only on the import page); the
 * statement and its password never leave the person's computer.
 *
 * pdf.js gives positioned text pieces. Pieces on the same baseline become one line, in x order; a gap wider than a
 * few points between pieces becomes a tab, which is how the CAS reader tells table columns apart.
 */

export type TextPiece = { str: string; x: number; y: number; width: number };

export function piecesToLines(pieces: TextPiece[], tolerance = 2): string[] {
  const rows: { y: number; pieces: TextPiece[] }[] = [];
  for (const p of pieces) {
    if (!p.str.trim()) continue;
    let row = rows.find((r) => Math.abs(r.y - p.y) <= tolerance);
    if (!row) rows.push((row = { y: p.y, pieces: [] }));
    row.pieces.push(p);
  }
  // PDF y grows upwards: top of the page first.
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const ps = r.pieces.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const p of ps) {
      const gap = p.x - end;
      if (out) out += gap > 6 ? "\t" : gap > 0.8 && !out.endsWith(" ") && !p.str.startsWith(" ") ? " " : "";
      out += p.str;
      end = p.x + p.width;
    }
    return out.trim();
  });
}

export class PdfPasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? "That password didn't open the statement. Check it and try again." : "This statement is password-protected. Enter its password.");
    this.name = "PdfPasswordError";
  }
}

/** All lines of a PDF, page by page. Browser only. */
export async function pdfLines(bytes: Uint8Array, password?: string): Promise<string[]> {
  // Never on the server: keeps pdf.js (1.7 MB) out of the Worker bundle.
  if (import.meta.env.SSR) throw new Error("pdfLines runs in the browser only");
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, password, isEvalSupported: false }).promise;
  } catch (e) {
    const name = (e as { name?: string; code?: number }).name;
    if (name === "PasswordException") throw new PdfPasswordError((e as { code?: number }).code === 2);
    throw e;
  }
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const pieces: TextPiece[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pieces.push({ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width });
    }
    lines.push(...piecesToLines(pieces));
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}
