/**
 * Turns the file formats registrars send into rows of { column: text }:
 *  - DBF (dBase III/IV), the CAMS mailback default
 *  - CSV and text files separated by commas, pipes, tildes, tabs or semicolons
 *  - XLSX (Excel 2007+). The old binary .xls isn't read: choose DBF, CSV or XLSX when requesting the report.
 * ZIPs are opened first (./zip.ts). Everything here also runs in the browser.
 */
import { isZip, readZip, ZipError } from "./zip";

export type Row = Record<string, string>;
export type Table = { name: string; rows: Row[] };

export class TableError extends Error {}

// ── DBF ───────────────────────────────────────────────────────────────────────

export function isDbf(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false;
  const v = bytes[0]!;
  const headerLen = bytes[8]! | (bytes[9]! << 8);
  return [0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x43, 0x63, 0x83, 0x8b, 0xcb, 0xf5].includes(v) && headerLen > 32 && headerLen < bytes.length + 1 && bytes[headerLen - 1] === 0x0d;
}

export function readDbf(bytes: Uint8Array): Row[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  const headerLen = view.getUint16(8, true);
  const recordLen = view.getUint16(10, true);
  const fields: { name: string; type: string; length: number; offset: number }[] = [];
  const latin1 = new TextDecoder("latin1");
  let offset = 1; // byte 0 of each record is the deletion flag
  for (let p = 32; p + 32 <= headerLen && bytes[p] !== 0x0d; p += 32) {
    const raw = bytes.subarray(p, p + 11);
    const end = raw.indexOf(0);
    const name = latin1.decode(end >= 0 ? raw.subarray(0, end) : raw).trim();
    const length = bytes[p + 16]!;
    fields.push({ name, type: String.fromCharCode(bytes[p + 11]!), length, offset });
    offset += length;
  }
  const rows: Row[] = [];
  for (let r = 0; r < count; r++) {
    const start = headerLen + r * recordLen;
    if (start + recordLen > bytes.length) break;
    if (bytes[start] === 0x2a) continue; // deleted
    const row: Row = {};
    for (const f of fields) {
      let v = latin1.decode(bytes.subarray(start + f.offset, start + f.offset + f.length)).trim();
      if (f.type === "D" && /^\d{8}$/.test(v)) v = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      row[f.name] = v;
    }
    rows.push(row);
  }
  return rows;
}

// ── Delimited text ────────────────────────────────────────────────────────────

function detectDelimiter(firstLine: string): string {
  const candidates = [",", "|", "~", "\t", ";"];
  let best = ",";
  let most = 0;
  for (const d of candidates) {
    const n = firstLine.split(d).length;
    if (n > most) {
      most = n;
      best = d;
    }
  }
  return best;
}

export function readDelimited(text: string): Row[] {
  const input = text.replace(/^﻿/, "");
  const firstLine = input.slice(0, input.search(/\r?\n|$/));
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return toObjects(rows);
}

function toObjects(rows: string[][]): Row[] {
  const filled = rows.filter((r) => r.some((v) => v.trim() !== ""));
  // Some reports put a title above the header: the header is the first row with several non-empty cells.
  const headerIndex = filled.findIndex((r) => r.filter((v) => v.trim()).length >= 4);
  if (headerIndex < 0) return [];
  const header = filled[headerIndex]!.map((h) => h.trim());
  return filled.slice(headerIndex + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// ── XLSX ──────────────────────────────────────────────────────────────────────

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date (days since 1899-12-30) → YYYY-MM-DD. */
export function excelDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
}

export async function readXlsx(bytes: Uint8Array): Promise<Row[]> {
  const entries = readZip(bytes);
  const get = async (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? new TextDecoder().decode(await e.read()) : null;
  };
  const shared: string[] = [];
  const sst = await get("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]!));
  // Which styles are dates, so serial numbers in date columns come out as dates.
  const dateStyles = new Set<number>();
  const styles = await get("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), m[2]!);
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => {
      const id = Number(m[1]);
      const code = custom.get(id) ?? "";
      // Built-in date formats are 14–22; a custom format with a day or year in it is a date (time-only ones have neither).
      if ((id >= 14 && id <= 22) || /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""))) dateStyles.add(i);
    });
  }
  const sheetName = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new TableError("This Excel file has no sheet.");
  const sheet = (await get(sheetName))!;
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const style = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const inner = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (v !== undefined) value = dateStyles.has(style) && /^\d+(\.\d+)?$/.test(v) ? excelDate(Number(v)) : xmlText(v);
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return toObjects(rows);
}

// ── Any file ──────────────────────────────────────────────────────────────────

function isXls(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** Reads one file (or every table inside a ZIP). `password` opens protected ZIPs. */
export async function readTables(name: string, bytes: Uint8Array, password?: string): Promise<Table[]> {
  if (isZip(bytes) && !/\.xlsx$/i.test(name)) {
    const entries = readZip(bytes);
    if (entries.length && entries.every((e) => /\[Content_Types\]\.xml|^xl\//.test(e.name))) return [{ name, rows: await readXlsx(bytes) }];
    const tables: Table[] = [];
    for (const e of entries) {
      if (/\.(pdf|htm|html)$/i.test(e.name)) continue;
      tables.push(...(await readTables(e.name, await e.read(password), password)));
    }
    return tables;
  }
  if (/\.xlsx$/i.test(name) || (isZip(bytes) && /\.xlsx$/i.test(name))) return [{ name, rows: await readXlsx(bytes) }];
  if (isXls(bytes)) {
    throw new TableError(`${name} is an old-style Excel (.xls) file. Request the report as DBF, CSV or XLSX, or save it as .xlsx and upload again.`);
  }
  if (isDbf(bytes)) return [{ name, rows: readDbf(bytes) }];
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) throw new TableError(`${name} isn't a file the app can read.`);
  return [{ name, rows: readDelimited(text) }];
}

export { ZipError };
