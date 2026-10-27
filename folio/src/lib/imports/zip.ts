/**
 * Reads ZIP files, including password-protected ones (traditional PKWARE encryption, which CAMS and KFintech
 * mailback files use). Runs in the browser, on Workers and in Node: inflating uses the built-in
 * DecompressionStream, nothing else.
 *
 * AES-encrypted ZIPs (method 99) are refused with a clear message: open them on the computer and upload the file
 * inside.
 */

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
        if (method === 99) {
          throw new ZipError("This ZIP uses AES encryption, which the browser can't open. Unzip it on your computer and upload the file inside.", "aes");
        }
        if (encrypted) {
          if (!password) throw new ZipError("This ZIP is password-protected. Enter its password.", "password_needed");
          const plain = zipCryptoDecrypt(data, password);
          // The 12-byte header's last byte must match the CRC's top byte (or the time, with a data descriptor).
          const check = plain[11];
          const expected = flags & 8 ? (modTime >>> 8) & 0xff : crc >>> 24;
          if (check !== expected) throw new ZipError("That password didn't open the ZIP. Check it and try again.", "wrong_password");
          data = plain.subarray(12);
        }
        let out: Uint8Array;
        if (method === 0) out = data;
        else if (method === 8) {
          try {
            out = await inflateRaw(data);
          } catch {
            throw new ZipError(encrypted ? "That password didn't open the ZIP. Check it and try again." : "The ZIP file is damaged.", encrypted ? "wrong_password" : "corrupt");
          }
        } else throw new ZipError(`This ZIP uses a compression method (${method}) the app can't read.`, "unsupported");
        if (crc32(out) !== crc) {
          throw new ZipError(encrypted ? "That password didn't open the ZIP. Check it and try again." : "The ZIP file is damaged.", encrypted ? "wrong_password" : "corrupt");
        }
        return out;
      },
    });
  }
  return entries;
}
