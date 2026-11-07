/**
 * Old-style Excel (.xls, BIFF8 inside a Compound File), as CAMS and KFintech attach to many mailbacks.
 *
 * Reads every sheet's cell values: shared strings (including ones split across CONTINUE records), inline labels,
 * numbers, RK/MULRK numbers and cached formula results. Numbers in date-formatted cells come out as YYYY-MM-DD,
 * like the .xlsx reader. Password-protected .xls files are refused with a plain message.
 */

import { md5, sha1 } from "@noble/hashes/legacy.js";

export class XlsError extends Error {
  constructor(
    message: string,
    readonly code: "password_needed" | "wrong_password" | "unsupported" | "corrupt" = "corrupt",
  ) {
    super(message);
  }
}

export type XlsSheet = { name: string; rows: string[][] };

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

/** The bytes of the workbook stream inside the Compound File. */
function workbookStream(bytes: Uint8Array): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0) throw new XlsError("This isn't an Excel file.");
  const sectorSize = 1 << v.getUint16(30, true);
  const miniSectorSize = 1 << v.getUint16(32, true);
  const numFatSectors = v.getUint32(44, true);
  const firstDirSector = v.getUint32(48, true);
  const miniCutoff = v.getUint32(56, true);
  const firstMiniFat = v.getUint32(60, true);
  let difatNext = v.getUint32(68, true);
  const sectorOffset = (s: number) => (s + 1) * sectorSize;
  // The FAT's own sectors: the first 109 listed in the header, the rest in DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) fatSectors.push(v.getUint32(76 + i * 4, true));
  for (let guard = 0; difatNext !== ENDOFCHAIN && difatNext !== FREESECT && fatSectors.length < numFatSectors && guard < 10000; guard++) {
    const off = sectorOffset(difatNext);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < numFatSectors; i++) fatSectors.push(v.getUint32(off + i * 4, true));
    difatNext = v.getUint32(off + per * 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const off = sectorOffset(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(off + i * 4 + 4 <= bytes.length ? v.getUint32(off + i * 4, true) : FREESECT);
  }
  const chain = (start: number, next: number[]): number[] => {
    const out: number[] = [];
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && s < next.length && out.length < 1_000_000; s = next[s]!) out.push(s);
    return out;
  };
  const readChain = (start: number, size: number) => {
    const out = new Uint8Array(chain(start, fat).length * sectorSize);
    chain(start, fat).forEach((s, i) => out.set(bytes.subarray(sectorOffset(s), sectorOffset(s) + sectorSize), i * sectorSize));
    return out.subarray(0, Math.min(size, out.length));
  };
  // Directory entries, 128 bytes each.
  const dir = readChain(firstDirSector, Number.MAX_SAFE_INTEGER);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dv.getUint16(off + 64, true);
    let name = "";
    for (let i = 0; i + 2 < nameLen; i += 2) name += String.fromCharCode(dv.getUint16(off + i, true));
    entries.push({ name, type: dir[off + 66]!, start: dv.getUint32(off + 116, true), size: dv.getUint32(off + 120, true) });
  }
  const book = entries.find((e) => e.type === 2 && (e.name === "Workbook" || e.name === "Book"));
  if (!book && entries.some((e) => e.name === "EncryptedPackage")) {
    throw new XlsError("This is a password-locked Excel 2007+ file (AES lock), which Folio can't open yet.", "unsupported");
  }
  if (!book) throw new XlsError("This Excel file has no workbook inside.");
  if (book.size >= miniCutoff) return readChain(book.start, book.size);
  // Small streams live in the mini stream, addressed through the mini FAT.
  const root = entries.find((e) => e.type === 5)!;
  const mini = readChain(root.start, root.size);
  const miniFatBytes = readChain(firstMiniFat, Number.MAX_SAFE_INTEGER);
  const mv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, i) => mv.getUint32(i * 4, true));
  const sectors = chain(book.start, miniFat);
  const out = new Uint8Array(sectors.length * miniSectorSize);
  sectors.forEach((s, i) => out.set(mini.subarray(s * miniSectorSize, (s + 1) * miniSectorSize), i * miniSectorSize));
  return out.subarray(0, book.size);
}

/** RK-encoded number (BIFF's compact number format). */
function rk(value: number): number {
  let n: number;
  if (value & 2) n = value >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, value & 0xfffffffc, true);
    n = buf.getFloat64(0, true);
  }
  return value & 1 ? n / 100 : n;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
}

function numberText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10);
}

export function readXls(bytes: Uint8Array, password?: string): XlsSheet[] {
  const wb = decryptIfNeeded(workbookStream(bytes), password);
  const v = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  // Records, with CONTINUE records kept beside the one they continue (needed for the shared strings).
  type Rec = { type: number; data: Uint8Array; continues: Uint8Array[] };
  const recs: Rec[] = [];
  for (let p = 0; p + 4 <= wb.length; ) {
    const type = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    const data = wb.subarray(p + 4, p + 4 + len);
    if (type === 0x003c && recs.length) recs[recs.length - 1]!.continues.push(data);
    else recs.push({ type, data, continues: [] });
    p += 4 + len;
  }
  if (recs[0]?.type !== 0x0809) throw new XlsError("This Excel file is in a format the app can't read.");

  // Shared strings: each string may continue into the next CONTINUE record, which repeats the 8/16-bit flag.
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfDate: boolean[] = [];
  const sheets: { name: string; offset: number }[] = [];
  for (const r of recs) {
    const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    if (r.type === 0x041e) {
      const id = d.getUint16(0, true);
      formats.set(id, readUnicode(r.data, 2, d.getUint16(2, true)).text);
    } else if (r.type === 0x00e0) {
      const fmt = d.getUint16(2, true);
      const code = (formats.get(fmt) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
      xfDate.push(BUILTIN_DATE_FORMATS.has(fmt) || /[dy]/i.test(code));
    } else if (r.type === 0x0085) {
      sheets.push({ name: readShort(r.data, 6), offset: d.getUint32(0, true) });
    } else if (r.type === 0x00fc) {
      const parts = [r.data, ...r.continues];
      let part = 0;
      let pos = 8;
      const total = d.getUint32(4, true);
      const byte = () => {
        while (pos >= parts[part]!.length) {
          part++;
          pos = 0;
          if (part >= parts.length) throw new XlsError("This Excel file's text table is damaged.");
        }
        return parts[part]![pos++]!;
      };
      const u16 = () => byte() | (byte() << 8);
      for (let i = 0; i < total && part < parts.length; i++) {
        if (pos >= parts[part]!.length) {
          part++;
          pos = 0;
          if (part >= parts.length) break;
        }
        const len = u16();
        let flags = byte();
        const rich = flags & 0x08 ? u16() : 0;
        const ext = flags & 0x04 ? u16() | (u16() << 16) : 0;
        let text = "";
        for (let c = 0; c < len; c++) {
          if (pos >= parts[part]!.length) {
            // A string split across records: the next part starts with a fresh 8/16-bit flag.
            part++;
            pos = 0;
            flags = (flags & ~1) | (byte() & 1);
          }
          text += String.fromCharCode(flags & 1 ? u16() : byte());
        }
        for (let k = 0; k < rich * 4 + ext; k++) byte();
        sst.push(text);
      }
    }
  }

  // Cell values per sheet, found by the BOF offset each BOUNDSHEET record points to.
  // Record index in `recs` ignores CONTINUE records, so map stream offsets to non-continue record indexes.
  const recIndexAt = new Map<number, number>();
  for (let p = 0, idx = -1; p + 4 <= wb.length; ) {
    const type = v.getUint16(p, true);
    if (type !== 0x003c) idx++;
    recIndexAt.set(p, idx);
    p += 4 + v.getUint16(p + 2, true);
  }
  const out: XlsSheet[] = [];
  for (const sh of sheets) {
    let i = recIndexAt.get(sh.offset);
    if (i === undefined) continue;
    const grid: string[][] = [];
    const put = (row: number, col: number, value: string) => {
      while (grid.length <= row) grid.push([]);
      const line = grid[row]!;
      while (line.length < col) line.push("");
      line[col] = value;
    };
    const num = (row: number, col: number, xf: number, n: number) => put(row, col, xfDate[xf] && n > 0 && n < 2958466 ? excelDate(n) : numberText(n));
    let pendingFormula: { row: number; col: number } | null = null;
    for (i = i + 1; i < recs.length; i++) {
      const r = recs[i]!;
      if (r.type === 0x000a) break;
      const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      if (r.data.length < 6 && r.type !== 0x0207) continue;
      switch (r.type) {
        case 0x00fd: // LABELSST
          put(d.getUint16(0, true), d.getUint16(2, true), sst[d.getUint32(6, true)] ?? "");
          break;
        case 0x0204: // LABEL
          put(d.getUint16(0, true), d.getUint16(2, true), readUnicode(r.data, 8, d.getUint16(6, true)).text);
          break;
        case 0x0203: // NUMBER
          num(d.getUint16(0, true), d.getUint16(2, true), d.getUint16(4, true), d.getFloat64(6, true));
          break;
        case 0x027e: // RK
          num(d.getUint16(0, true), d.getUint16(2, true), d.getUint16(4, true), rk(d.getInt32(6, true)));
          break;
        case 0x00bd: {
          // MULRK
          const row = d.getUint16(0, true);
          const first = d.getUint16(2, true);
          const count = (r.data.length - 6) / 6;
          for (let k = 0; k < count; k++) num(row, first + k, d.getUint16(4 + k * 6, true), rk(d.getInt32(6 + k * 6, true)));
          break;
        }
        case 0x0006: {
          // FORMULA: a cached number, or a string in the STRING record that follows.
          const row = d.getUint16(0, true);
          const col = d.getUint16(2, true);
          if (d.getUint16(12, true) === 0xffff) {
            const kind = r.data[6];
            if (kind === 0) pendingFormula = { row, col };
            else if (kind === 1) put(row, col, r.data[8] ? "TRUE" : "FALSE");
          } else num(row, col, d.getUint16(4, true), d.getFloat64(6, true));
          break;
        }
        case 0x0207: // STRING (a formula's text result)
          if (pendingFormula) put(pendingFormula.row, pendingFormula.col, readUnicode(r.data, 2, d.getUint16(0, true)).text);
          pendingFormula = null;
          break;
        case 0x0205: // BOOLERR
          if (r.data[7] === 0) put(d.getUint16(0, true), d.getUint16(2, true), r.data[6] ? "TRUE" : "FALSE");
          break;
      }
    }
    out.push({ name: sh.name, rows: grid });
  }
  return out;
}

/** A BIFF8 unicode string body at `offset` (flags byte first) with `len` characters. */
function readUnicode(data: Uint8Array, offset: number, len: number): { text: string; end: number } {
  const flags = data[offset] ?? 0;
  let p = offset + 1;
  const rich = flags & 0x08 ? data[p]! | (data[p + 1]! << 8) : 0;
  if (flags & 0x08) p += 2;
  if (flags & 0x04) p += 4;
  let text = "";
  for (let c = 0; c < len && p < data.length; c++) {
    if (flags & 1) {
      text += String.fromCharCode(data[p]! | (data[p + 1]! << 8));
      p += 2;
    } else text += String.fromCharCode(data[p++]!);
  }
  return { text, end: p + rich * 4 };
}

/** A sheet name: 1-byte length, then a unicode string body. */
function readShort(data: Uint8Array, offset: number): string {
  return readUnicode(data, offset + 1, data[offset] ?? 0).text;
}

// ── Password-protected .xls (RC4, and RC4 CryptoAPI) ──────────────────────────
// MS-XLS 2.2.10 and MS-OFFCRYPTO 2.3.6: record headers stay readable; record data is RC4-encrypted with a key that
// changes every 1024 bytes of the stream, counted from the stream's start (headers included).

const NEVER_ENCRYPTED = new Set([0x0809, 0x002f, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138]);
const utf16 = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const le32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);

function rc4(key: Uint8Array, length: number): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    [S[i], S[j]] = [S[j]!, S[i]!];
  }
  const out = new Uint8Array(length);
  for (let k = 0, i = 0, j = 0; k < length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]!) & 0xff;
    [S[i], S[j]] = [S[j]!, S[i]!];
    out[k] = S[(S[i]! + S[j]!) & 0xff]!;
  }
  return out;
}

/** The block key maker for the file's encryption, after checking the password against the file's verifier. */
function keyMaker(filepass: Uint8Array, password: string): (block: number) => Uint8Array {
  const v = new DataView(filepass.buffer, filepass.byteOffset, filepass.byteLength);
  if (v.getUint16(0, true) !== 1) throw new XlsError("This Excel file uses an old protection the app can't open. Open it in Excel, remove the password, and upload it again.", "unsupported");
  const major = v.getUint16(2, true);
  const minor = v.getUint16(4, true);
  const pw = utf16(password);
  if (major === 1 && minor === 1) {
    const salt = filepass.subarray(6, 22);
    const verifier = filepass.subarray(22, 38);
    const verifierHash = filepass.subarray(38, 54);
    const h0 = md5(pw).subarray(0, 5);
    const buf = new Uint8Array(21 * 16);
    for (let i = 0; i < 16; i++) buf.set(concat(h0, salt), i * 21);
    const h1 = md5(buf).subarray(0, 5);
    const make = (block: number) => md5(concat(h1, le32(block)));
    const ks = rc4(make(0), 32);
    const plain = concat(verifier, verifierHash).map((b, i) => b ^ ks[i]!);
    const ok = md5(plain.subarray(0, 16)).every((b, i) => b === plain[16 + i]);
    if (!ok) throw new XlsError("That password didn't open this Excel file (RC4 lock).", "wrong_password");
    return make;
  }
  if ((major === 2 || major === 3 || major === 4) && minor === 2) {
    const headerSize = v.getUint32(10, true);
    const header = 14;
    let keyBits = v.getUint32(header + 16, true);
    if (keyBits === 0) keyBits = 40;
    const ver = header + headerSize;
    const saltSize = v.getUint32(ver, true);
    const salt = filepass.subarray(ver + 4, ver + 4 + saltSize);
    const verifier = filepass.subarray(ver + 4 + saltSize, ver + 20 + saltSize);
    const hashSize = v.getUint32(ver + 20 + saltSize, true);
    const verifierHash = filepass.subarray(ver + 24 + saltSize, ver + 24 + saltSize + hashSize);
    const h0 = sha1(concat(salt, pw));
    const make = (block: number) => {
      const h = sha1(concat(h0, le32(block)));
      return keyBits === 40 ? concat(h.subarray(0, 5), new Uint8Array(11)) : h.subarray(0, keyBits / 8);
    };
    const ks = rc4(make(0), 16 + verifierHash.length);
    const plain = concat(verifier, verifierHash).map((b, i) => b ^ ks[i]!);
    const ok = sha1(plain.subarray(0, 16)).every((b, i) => b === plain[16 + i]);
    if (!ok) throw new XlsError(`That password didn't open this Excel file (RC4 CryptoAPI ${keyBits}-bit lock).`, "wrong_password");
    return make;
  }
  throw new XlsError("This Excel file uses a protection the app can't open yet. Open it in Excel, remove the password, and upload it again.", "unsupported");
}

/** The workbook stream with record data decrypted, when the file is password-protected; unchanged otherwise. */
function decryptIfNeeded(wb: Uint8Array, password?: string): Uint8Array {
  const v = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  let filepass: Uint8Array | null = null;
  for (let p = 0; p + 4 <= wb.length; p += 4 + v.getUint16(p + 2, true)) {
    if (v.getUint16(p, true) === 0x002f) {
      filepass = wb.subarray(p + 4, p + 4 + v.getUint16(p + 2, true));
      break;
    }
  }
  if (!filepass) return wb;
  if (!password) throw new XlsError("This Excel file is password-protected. Save the registrar's password in Settings.", "password_needed");
  const make = keyMaker(filepass, password);
  // Keystream for the whole stream, a fresh RC4 key every 1024 bytes.
  const ks = new Uint8Array(wb.length);
  for (let block = 0; block * 1024 < wb.length; block++) ks.set(rc4(make(block), Math.min(1024, wb.length - block * 1024)), block * 1024);
  const out = new Uint8Array(wb);
  for (let p = 0; p + 4 <= wb.length; ) {
    const type = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    const start = p + 4 + (type === 0x0085 ? 4 : 0); // a sheet record's stream position stays readable
    if (type === 0x002f) {
      // Blank the protection record but keep its length, so the records after it still line up.
      out[p] = 0;
      out[p + 1] = 0;
      out.fill(0, p + 4, p + 4 + len);
    }
    else if (!NEVER_ENCRYPTED.has(type)) for (let i = start; i < p + 4 + len; i++) out[i] = wb[i]! ^ ks[i]!;
    p += 4 + len;
  }
  return out;
}
