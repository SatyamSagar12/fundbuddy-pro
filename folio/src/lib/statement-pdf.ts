/**
 * The branded portfolio statement as a PDF, made in the browser with pdf-lib. Loaded only when someone presses the
 * button (`import("@/lib/statement-pdf")`), so the library never weighs down the app's pages.
 *
 * A4, the practice's name, ARN and EUIN on top, the AMFI disclaimer on every page. pdf-lib's built-in Helvetica has
 * no ₹ sign, so amounts read "Rs 1,23,456"; letters outside its character set (e.g. Devanagari) become "?".
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { AMFI_DISCLAIMER, type StatementData } from "./statement";

const INK = rgb(0x1e / 255, 0x29 / 255, 0x23 / 255);
const BONE = rgb(0xf1 / 255, 0xed / 255, 0xe4 / 255);
const BRONZE = rgb(0x7a / 255, 0x5a / 255, 0x2e / 255);
const MUTED = rgb(0x61 / 255, 0x5d / 255, 0x56 / 255);
const LINE = rgb(0.85, 0.84, 0.81);
const GOOD = rgb(0x3b / 255, 0x6a / 255, 0x48 / 255);
const BAD = rgb(0xa3 / 255, 0x36 / 255, 0x2b / 255);

const W = 595.28;
const H = 841.89;
const M = 40;
const FOOT = 58;

/** Windows-1252 letters the standard fonts can draw; anything else becomes "?". */
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(text: string): string {
  return text
    .replace(/₹\s?/g, "Rs ")
    .replace(/≈/g, "~")
    .replace(/[  ]/g, " ")
    .replace(/./gu, (c) => {
      const code = c.codePointAt(0)!;
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_EXTRA.includes(c) ? c : "?";
    });
}

export function rupees(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(1)}%`);
const dmy = (d: string | null) => {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
};
const TYPE: Record<string, string> = {
  purchase: "One-time",
  sip: "SIP",
  redemption: "Redemption",
  switch_in: "Switch in",
  switch_out: "Switch out",
  idcw_reinvest: "IDCW reinvest",
  idcw_payout: "IDCW payout",
};

type Col<R> = { label: string; width: number; align?: "left" | "right"; text: (r: R) => string; color?: (r: R) => ReturnType<typeof rgb> | undefined };

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly serif: PDFFont,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
  }

  /** Starts a new page when fewer than `h` points are left above the footer. */
  room(h: number): boolean {
    if (this.y - h >= FOOT) return false;
    this.newPage();
    return true;
  }

  text(t: string, x: number, size: number, opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; y?: number } = {}) {
    this.page.drawText(pdfSafe(t), { x, y: opts.y ?? this.y, size, font: opts.font ?? this.font, color: opts.color ?? INK });
  }

  width(t: string, size: number, font = this.font) {
    return font.widthOfTextAtSize(pdfSafe(t), size);
  }

  /** Splits text into lines no wider than `max`. */
  wrap(t: string, size: number, max: number, font = this.font): string[] {
    const words = pdfSafe(t).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  heading(t: string) {
    this.room(60);
    this.y -= 22;
    this.text(t, M, 13, { font: this.bold });
    this.y -= 10;
  }

  table<R>(cols: Col<R>[], rows: readonly R[]) {
    const size = 8.5;
    const header = () => {
      this.y -= 12;
      let x = M;
      for (const c of cols) {
        const label = c.label.toUpperCase();
        const w = this.width(label, 7, this.bold);
        this.text(label, c.align === "right" ? x + c.width - w - 2 : x, 7, { font: this.bold, color: MUTED });
        x += c.width;
      }
      this.y -= 6;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: LINE });
    };
    header();
    for (const r of rows) {
      const cells = cols.map((c) => this.wrap(c.text(r), size, c.width - 6, c === cols[0] ? this.bold : this.font));
      const h = Math.max(...cells.map((l) => l.length)) * 11 + 6;
      if (this.room(h + 4)) header();
      let x = M;
      const top = this.y - 11;
      cols.forEach((c, i) => {
        cells[i]!.forEach((line, j) => {
          const font = i === 0 ? this.bold : this.font;
          const w = font.widthOfTextAtSize(line, size);
          this.page.drawText(line, { x: c.align === "right" ? x + c.width - w - 2 : x, y: top - j * 11, size, font, color: c.color?.(r) ?? INK });
        });
        x += c.width;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.4, color: LINE });
    }
  }
}

const tone = (n: number | null) => (n === null || n === 0 ? undefined : n > 0 ? GOOD : BAD);

export async function statementPdf(d: StatementData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.title}: portfolio statement`));
  doc.setAuthor(pdfSafe(d.practice.name));
  doc.setCreator("Anqulas Folio");
  doc.setCreationDate(new Date(`${d.generatedOn}T12:00:00+05:30`));
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), await doc.embedFont(StandardFonts.TimesRoman));
  w.newPage();

  // Brand band: the practice, its ARN and EUIN.
  const band = 78;
  w.page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: INK });
  w.text(d.practice.name, M, 17, { font: w.bold, color: BONE, y: H - 38 });
  const reg = [d.practice.arn, d.practice.euin ? `EUIN ${d.practice.euin}` : null].filter(Boolean).join("   ·   ");
  w.text(reg || "Mutual fund distributor", M, 9, { color: rgb(0.8, 0.78, 0.72), y: H - 56 });
  const right = "Portfolio statement";
  w.text(right, W - M - w.width(right, 10, w.bold), 10, { font: w.bold, color: rgb(0xcd / 255, 0xae / 255, 0x7e / 255), y: H - 38 });
  const when = `As on ${dmy(d.generatedOn)}`;
  w.text(when, W - M - w.width(when, 9), 9, { color: rgb(0.8, 0.78, 0.72), y: H - 56 });
  w.y = H - band - 40;

  // Who it's for.
  w.text(d.title, M, 24, { font: w.serif });
  w.y -= 16;
  const who = d.isFamily ? `Family of ${d.people.length}: ${d.people.join(", ")}` : "";
  for (const line of w.wrap([who, d.navDate ? `Values at the NAV of ${dmy(d.navDate)}` : ""].filter(Boolean).join("   ·   "), 9.5, W - 2 * M)) {
    w.text(line, M, 9.5, { color: MUTED });
    w.y -= 13;
  }

  // Four figures.
  w.y -= 8;
  const tiles = [
    { k: "CURRENT VALUE", v: rupees(d.total.value) },
    { k: "INVESTED", v: rupees(d.total.invested) },
    { k: "GAIN", v: rupees(d.total.gain), c: tone(d.total.gain) },
    { k: d.total.returnLabel.toUpperCase(), v: pct(d.total.returnValue) },
  ];
  const tw = (W - 2 * M - 3 * 8) / 4;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + 8);
    w.page.drawRectangle({ x, y: w.y - 52, width: tw, height: 52, color: BONE, borderColor: LINE, borderWidth: 0.6 });
    w.text(t.k, x + 10, 7, { font: w.bold, color: MUTED, y: w.y - 16 });
    w.text(t.v, x + 10, 15, { font: w.serif, color: t.c ?? INK, y: w.y - 38 });
  });
  w.y -= 52;

  w.heading("Holdings");
  if (!d.holdings.length && !d.notValued.length) {
    w.y -= 4;
    w.text("No holdings yet.", M, 9.5, { color: MUTED });
    w.y -= 8;
  } else {
    const fam = d.isFamily;
    type Hd = StatementData["holdings"][number];
    const cols: Col<Hd>[] = [
      { label: "Scheme", width: fam ? 170 : 215, text: (h) => h.scheme },
      ...(fam ? [{ label: "Member", width: 70, text: (h: Hd) => h.member }] : []),
      { label: "Units", width: 55, align: "right", text: (h) => `${h.estimated ? "~" : ""}${h.units.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}` },
      { label: "Invested", width: 62, align: "right", text: (h) => rupees(h.invested) },
      { label: "Value", width: 62, align: "right", text: (h) => (h.value === null ? "-" : rupees(h.value)) },
      { label: "Gain", width: 58, align: "right", text: (h) => (h.gain === null ? "-" : rupees(h.gain)), color: (h) => tone(h.gain) },
      { label: "Return", width: fam ? 38 : 63, align: "right", text: (h) => `${pct(h.returnValue)}${h.returnLabel === "XIRR" ? "" : "*"}` },
    ];
    w.table(cols, d.holdings);
    if (d.notValued.length) {
      w.table<StatementData["notValued"][number]>(
        [
          { label: "Not valued yet (scheme to be matched)", width: W - 2 * M - 80, text: (u) => u.scheme },
          { label: "Invested", width: 80, align: "right", text: (u) => rupees(u.invested) },
        ],
        d.notValued,
      );
    }
    w.room(24);
    w.y -= 12;
    w.text("Return is XIRR (yearly) for money held a year or more; * is the plain return, for money held less than a year. ~ units estimated from NAV.", M, 7, { color: MUTED });
  }

  w.heading("SIPs");
  if (!d.sips.length) {
    w.text("No SIPs.", M, 9.5, { color: MUTED, y: w.y - 4 });
    w.y -= 12;
  } else {
    type S = StatementData["sips"][number];
    w.table<S>(
      [
        { label: "Scheme", width: d.isFamily ? 205 : 275, text: (s) => s.scheme },
        ...(d.isFamily ? [{ label: "Member", width: 70, text: (s: S) => s.member }] : []),
        { label: "Amount", width: 65, align: "right", text: (s) => rupees(s.amount) },
        { label: "Every", width: 60, align: "right", text: (s) => (s.frequency === "quarterly" ? "Quarter" : s.frequency === "weekly" ? "Week" : "Month") },
        { label: "Since", width: 60, align: "right", text: (s) => dmy(s.since) },
        { label: "Status", width: 55, align: "right", text: (s) => s.status[0]!.toUpperCase() + s.status.slice(1) },
      ],
      d.sips,
    );
  }

  w.heading("Transactions in the last 12 months");
  if (!d.transactions.length) {
    w.text("None.", M, 9.5, { color: MUTED, y: w.y - 4 });
    w.y -= 12;
  } else {
    type T = StatementData["transactions"][number];
    w.table<T>(
      [
        { label: "Date", width: 62, text: (t) => dmy(t.date) },
        { label: "Scheme", width: d.isFamily ? 185 : 255, text: (t) => t.scheme },
        ...(d.isFamily ? [{ label: "Member", width: 70, text: (t: T) => t.member }] : []),
        { label: "Type", width: 70, text: (t) => TYPE[t.type] ?? t.type },
        { label: "Amount", width: 63, align: "right", text: (t) => rupees(t.amount) },
        { label: "Units", width: 65, align: "right", text: (t) => (t.units === null ? "-" : t.units.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })) },
      ],
      d.transactions,
    );
  }

  // Footer on every page: the AMFI disclaimer, who prepared it, page numbers.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    w.page = pg;
    pg.drawLine({ start: { x: M, y: FOOT - 10 }, end: { x: W - M, y: FOOT - 10 }, thickness: 0.6, color: LINE });
    w.text(AMFI_DISCLAIMER, M, 7.5, { font: w.bold, color: BRONZE, y: FOOT - 23 });
    const by = `Prepared by ${d.practice.name}${d.practice.arn ? ` (${d.practice.arn})` : ""}, an AMFI-registered mutual fund distributor. Values use the latest NAV and are not an account statement from the fund house.`;
    w.wrap(by, 6.5, W - 2 * M - 50).forEach((line, j) => w.text(line, M, 6.5, { color: MUTED, y: FOOT - 34 - j * 8 }));
    const n = `Page ${i + 1} of ${pages.length}`;
    w.text(n, W - M - w.width(n, 7), 7, { color: MUTED, y: FOOT - 34 });
  });
  return doc.save();
}
