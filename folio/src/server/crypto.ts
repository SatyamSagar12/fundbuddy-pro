/**
 * Encryption and hashing (Web Crypto: works on Cloudflare Workers and in Node for tests).
 *
 * Keys:
 *  - MASTER_KEY (secret): never stored in the database. Wraps each practice's own data key and the
 *    authenticator secrets.
 *  - Practice data key: 32 random bytes per practice, stored only wrapped. Encrypts that practice's PAN,
 *    bank and nominee details, and keys the PAN search hash. A database dump alone reveals none of them.
 *
 * Every ciphertext is bound to what it belongs to (AAD = purpose + owner id), so a value copied into
 * another row or practice fails to decrypt instead of showing up there.
 *
 * Format: "v1.<iv base64url>.<ciphertext base64url>" (AES-256-GCM).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(text: string): Uint8Array {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(): string {
  return toB64url(randomBytes(32));
}

/**
 * A secret key setting: either 32 random bytes in base64, or any random text of at least 32 characters (it is
 * hashed to 32 bytes), so a password manager's "generate password" works too.
 */
async function keyBytes(secret: string, name: string): Promise<Uint8Array> {
  const text = secret.trim();
  try {
    const bytes = fromB64(text);
    if (bytes.length === 32 && /^[A-Za-z0-9+/_-]{43}=?$/.test(text)) return bytes;
  } catch {
    // not base64: treated as text below
  }
  if (text.length < 32) throw new Error(`${name} must be at least 32 random characters`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`anqulas-folio:${name}:${text}`)));
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) },
    key,
    plaintext as BufferSource,
  );
  return `v1.${toB64url(iv)}.${toB64url(new Uint8Array(ct))}`;
}

async function open(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array> {
  const [version, iv, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unknown ciphertext format");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource, additionalData: enc.encode(aad) },
    key,
    fromB64(ct) as BufferSource,
  );
  return new Uint8Array(pt);
}

/** HMAC-SHA256, hex. */
export async function hmacHex(secretBase64: string, data: string): Promise<string> {
  const key = await hmacKey(await keyBytes(secretBase64, "SESSION_SECRET"));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Master key ────────────────────────────────────────────────────────────────

export async function newWrappedDataKey(masterKeyB64: string, practiceId: string): Promise<string> {
  const master = await aesKey(await keyBytes(masterKeyB64, "MASTER_KEY"));
  return seal(master, randomBytes(32), `practice-key:${practiceId}`);
}

export async function sealWithMaster(masterKeyB64: string, plaintext: string, aad: string): Promise<string> {
  return seal(await aesKey(await keyBytes(masterKeyB64, "MASTER_KEY")), enc.encode(plaintext), aad);
}

export async function openWithMaster(masterKeyB64: string, sealed: string, aad: string): Promise<string> {
  return dec.decode(await open(await aesKey(await keyBytes(masterKeyB64, "MASTER_KEY")), sealed, aad));
}

// ── Practice data key ─────────────────────────────────────────────────────────

export type PracticeCrypto = {
  /** Encrypts a field of one record. `recordId` ties it to that record. */
  encrypt(field: string, recordId: string, plaintext: string): Promise<string>;
  decrypt(field: string, recordId: string, sealed: string): Promise<string>;
  /** Keyed hash of a normalised tax id, for finding a client by PAN without decrypting. */
  taxIdHash(taxId: string): Promise<string>;
};

export function normaliseTaxId(taxId: string): string {
  return taxId.replace(/\s+/g, "").toUpperCase();
}

export async function practiceCrypto(
  masterKeyB64: string,
  practiceId: string,
  wrappedKey: string,
): Promise<PracticeCrypto> {
  const master = await aesKey(await keyBytes(masterKeyB64, "MASTER_KEY"));
  const raw = await open(master, wrappedKey, `practice-key:${practiceId}`);
  const key = await aesKey(raw);
  const hkey = await hmacKey(raw);
  const aad = (field: string, recordId: string) => `${practiceId}:${field}:${recordId}`;
  return {
    encrypt: (field, recordId, plaintext) => seal(key, enc.encode(plaintext), aad(field, recordId)),
    decrypt: async (field, recordId, sealed) => dec.decode(await open(key, sealed, aad(field, recordId))),
    taxIdHash: async (taxId) => {
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hkey, enc.encode(`tax-id:${normaliseTaxId(taxId)}`)));
      return toB64url(sig);
    },
  };
}
