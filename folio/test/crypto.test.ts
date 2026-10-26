import { describe, expect, it } from "vitest";
import { newWrappedDataKey, practiceCrypto, sealWithMaster, openWithMaster, toB64url, randomBytes } from "@/server/crypto";
import { base32Encode, totpCode, verifyTotp } from "@/server/totp";
import { hashPassword, verifyPassword } from "@/server/password";

const MASTER = toB64url(randomBytes(32));

describe("practice encryption", () => {
  it("round-trips and binds ciphertext to its practice, field and record", async () => {
    const wrapped = await newWrappedDataKey(MASTER, "p1");
    const pc = await practiceCrypto(MASTER, "p1", wrapped);
    const sealed = await pc.encrypt("tax_id", "inv1", "ABCDE1234F");
    expect(sealed).not.toContain("ABCDE");
    expect(await pc.decrypt("tax_id", "inv1", sealed)).toBe("ABCDE1234F");
    await expect(pc.decrypt("tax_id", "inv2", sealed)).rejects.toThrow();
    await expect(pc.decrypt("bank", "inv1", sealed)).rejects.toThrow();
  });

  it("cannot unwrap one practice's key as another's, or with another master key", async () => {
    const wrapped = await newWrappedDataKey(MASTER, "p1");
    await expect(practiceCrypto(MASTER, "p2", wrapped)).rejects.toThrow();
    await expect(practiceCrypto(toB64url(randomBytes(32)), "p1", wrapped)).rejects.toThrow();
  });

  it("hashes PANs per practice, ignoring case and spaces", async () => {
    const a = await practiceCrypto(MASTER, "p1", await newWrappedDataKey(MASTER, "p1"));
    const b = await practiceCrypto(MASTER, "p2", await newWrappedDataKey(MASTER, "p2"));
    expect(await a.taxIdHash("abcde 1234f")).toBe(await a.taxIdHash("ABCDE1234F"));
    expect(await a.taxIdHash("ABCDE1234F")).not.toBe(await b.taxIdHash("ABCDE1234F"));
  });

  it("seals with the master key", async () => {
    const s = await sealWithMaster(MASTER, "secret", "totp:u1");
    expect(await openWithMaster(MASTER, s, "totp:u1")).toBe("secret");
    await expect(openWithMaster(MASTER, s, "totp:u2")).rejects.toThrow();
  });
});

describe("totp", () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890".
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  it("matches the RFC test vectors", async () => {
    expect(await totpCode(secret, Math.floor(59 / 30))).toBe("287082");
    expect(await totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(await totpCode(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("accepts one step either side, and never the same step twice", async () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    const code = await totpCode(secret, step);
    expect(await verifyTotp(secret, code, null, now)).toBe(step);
    expect(await verifyTotp(secret, code, step, now)).toBeNull();
    expect(await verifyTotp(secret, await totpCode(secret, step - 2), null, now)).toBeNull();
  });
});

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});
