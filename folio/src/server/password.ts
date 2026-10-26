/**
 * Password hashing with Argon2id, at OWASP's recommended minimum: 19 MiB memory, 2 passes, 1 lane.
 *
 * Pure JavaScript (@noble/hashes), because Cloudflare Workers refuse WebAssembly compiled at runtime.
 * About 0.25 s per hash, and it only runs at sign-up and sign-in. Stored in the standard PHC format
 * ($argon2id$v=19$m=…,t=…,p=…$salt$hash), so the parameters can be raised later and old hashes still verify.
 */
import { argon2id } from "@noble/hashes/argon2.js";
import { fromB64, randomBytes } from "./crypto";

const PARAMS = { m: 19456, t: 2, p: 1 } as const;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = argon2id(password, salt, { ...PARAMS, dkLen: 32 });
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded);
  if (!match) return false;
  const [, m, t, p, saltB64, hashB64] = match;
  const expected = fromB64(hashB64!);
  const actual = argon2id(password, fromB64(saltB64!), {
    m: Number(m),
    t: Number(t),
    p: Number(p),
    dkLen: expected.length,
  });
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** A real hash to compare against when the email is unknown, so timing does not reveal accounts. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword("not-a-real-password-" + crypto.randomUUID()));
}

export const PASSWORD_MIN = 10;

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return "That password is too long.";
  if (password.toLowerCase().includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4)
    return "Don't use your email name in the password.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  return null;
}
