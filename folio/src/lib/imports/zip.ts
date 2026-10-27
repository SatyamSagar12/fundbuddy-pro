/**
 * Reads ZIP files, including password-protected ones: traditional PKWARE encryption, and WinZip AES (128/192/256
 * bit), which CAMS mailback files use. Runs in the browser, on Workers and in Node: inflating uses the built-in
 * DecompressionStream, key derivation and the integrity check use Web Crypto, and AES blocks come from the audited
 * @noble/ciphers.
 */
import { ecb } from "@noble/ciphers/aes.js";

export class ZipError extends Error {
  constructor(
    message: string,
    readonly code: "not_zip" | "password_needed" | "wrong_password" | "aes" | "unsupported" | "corrupt",
  ) {
    super(message);
  }
}

export type ZipEntry = { name: string; size: number; encrypted: boolean; read: (password?: string) => Promise<Uint8Array> };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Update(crc: number, byte: number): number {
  return (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
}

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = crc32Update(c, b);
  return (c ^ 0xffffffff) >>> 0;
}

/** Traditional PKWARE ("ZipCrypto") decryption. */
function zipCryptoDecrypt(data: Uint8Array, password: string): Uint8Array {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (b: number) => {
    k0 = crc32Update(k0, b);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crc32Update(k2, k1 >>> 24);
  };
  for (const b of new TextEncoder().encode(password)) update(b);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const temp = (k2 | 2) & 0xffff;
    const c = data[i]! ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 0xff);
    update(c);
    out[i] = c;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

/** Lists a ZIP's files (from its central directory). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This isn't a ZIP file.", "not_zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError("The ZIP file is damaged.", "corrupt");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const modTime = view.getUint16(p + 12, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const aes = method === 99 ? aesInfo(bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)) : null;
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const encrypted = (flags & 1) === 1;
    entries.push({
      name,
      size,
      encrypted,
      read: async (password?: string) => {
        if (view.getUint32(local, true) !== 0x04034b50) throw new ZipError("The ZIP file is damaged.", "corrupt");
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        let data = bytes.subarray(start, start + compSize);
        let actualMethod = method;
        let checkCrc = true;
        if (method === 99) {
          if (!aes) throw new ZipError("This ZIP's encryption details are missing or damaged.", "corrupt");
          if (!password) throw new ZipError("This ZIP is password-protected. Enter its password.", "password_needed");
          data = await aesDecrypt(data, password, aes.strength);
          actualMethod = aes.method;
          // AE-2 leaves the CRC out (the HMAC already proved the data intact).
          checkCrc = aes.version === 1;
        } else if (encrypted) {
          if (!password) throw new ZipError("This ZIP is password-protected. Enter its password.", "password_needed");
          const plain = zipCryptoDecrypt(data, password);
          // The 12-byte header's last byte must match the CRC's top byte (or the time, with a data descriptor).
          const check = plain[11];
          const expected = flags & 8 ? (modTime >>> 8) & 0xff : crc >>> 24;
          if (check !== expected) throw new ZipError("That password didn't open the ZIP. Check it and try again.", "wrong_password");
          data = plain.subarray(12);
        }
        let out: Uint8Array;
        if (actualMethod === 0) out = data;
        else if (actualMethod === 8) {
          try {
            out = await inflateRaw(data);
          } catch {
            throw new ZipError(encrypted ? "That password didn't open the ZIP. Check it and try again." : "The ZIP file is damaged.", encrypted ? "wrong_password" : "corrupt");
          }
        } else throw new ZipError(`This ZIP uses a compression method (${actualMethod}) the app can't read.`, "unsupported");
        if (checkCrc && crc32(out) !== crc) {
          throw new ZipError(encrypted ? "That password didn't open the ZIP. Check it and try again." : "The ZIP file is damaged.", encrypted ? "wrong_password" : "corrupt");
        }
        return out;
      },
    });
  }
  return entries;
}

// ── WinZip AES (APPNOTE "AE-1" / "AE-2") ───────────────────────────────────────

type AesInfo = { version: number; strength: 1 | 2 | 3; method: number };

/** The 0x9901 extra field: vendor version, "AE", key strength, and the real compression method. */
function aesInfo(extra: Uint8Array): AesInfo | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let i = 0; i + 4 <= extra.length; ) {
    const id = view.getUint16(i, true);
    const size = view.getUint16(i + 2, true);
    if (id === 0x9901 && size >= 7) {
      const strength = extra[i + 8]!;
      if (strength < 1 || strength > 3) return null;
      return { version: view.getUint16(i + 4, true), strength: strength as 1 | 2 | 3, method: view.getUint16(i + 9, true) };
    }
    i += 4 + size;
  }
  return null;
}

async function aesDecrypt(data: Uint8Array, password: string, strength: 1 | 2 | 3): Promise<Uint8Array> {
  const keyLen = 8 + strength * 8; // 16, 24, 32
  const saltLen = 4 + strength * 4; // 8, 12, 16
  if (data.length < saltLen + 2 + 10) throw new ZipError("The ZIP file is damaged.", "corrupt");
  const salt = data.subarray(0, saltLen);
  const verifier = data.subarray(saltLen, saltLen + 2);
  const body = data.subarray(saltLen + 2, data.length - 10);
  const mac = data.subarray(data.length - 10);

  const pwKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-1", salt: salt as BufferSource, iterations: 1000 }, pwKey, (keyLen * 2 + 2) * 8),
  );
  const encKey = derived.subarray(0, keyLen);
  const macKey = derived.subarray(keyLen, keyLen * 2);
  if (derived[keyLen * 2] !== verifier[0] || derived[keyLen * 2 + 1] !== verifier[1]) {
    throw new ZipError("That password didn't open the ZIP. Check it and try again.", "wrong_password");
  }
  const hmacKey = await crypto.subtle.importKey("raw", macKey as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, body as BufferSource)).subarray(0, 10);
  if (sig.some((b, i) => b !== mac[i])) throw new ZipError("The ZIP file is damaged (its integrity check failed).", "corrupt");

  // AES-CTR with a little-endian block counter starting at 1 (unlike Web Crypto's big-endian counter), so the
  // keystream is built from AES blocks directly, 64 KB at a time.
  const out = new Uint8Array(body.length);
  const CHUNK = 4096; // blocks
  let counter = 1;
  for (let off = 0; off < body.length; off += CHUNK * 16) {
    const blocks = Math.min(CHUNK, Math.ceil((body.length - off) / 16));
    const ctr = new Uint8Array(blocks * 16);
    for (let b = 0; b < blocks; b++, counter++) {
      let c = counter;
      for (let k = 0; k < 8 && c > 0; k++) {
        ctr[b * 16 + k] = c & 0xff;
        c = Math.floor(c / 256);
      }
    }
    // A fresh cipher per chunk: the library refuses to reuse one (its guard against nonce reuse).
    const stream = ecb(encKey, { disablePadding: true }).encrypt(ctr);
    const end = Math.min(body.length, off + blocks * 16);
    for (let i = off; i < end; i++) out[i] = body[i]! ^ stream[i - off]!;
  }
  return out;
}
