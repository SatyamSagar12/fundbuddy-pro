/**
 * "Continue with Google" (OpenID Connect, authorization code flow with PKCE).
 *
 * - The state and PKCE verifier travel in a short-lived, HMAC-signed, HTTPS-only cookie, so a callback that
 *   didn't start here is refused.
 * - The ID token comes straight from Google's token endpoint over TLS (not through the browser), so its claims
 *   are trusted after checking issuer, audience, expiry and that Google verified the email.
 * - An existing account with that email signs in (its authenticator, if on, is still asked for). A new email gets
 *   a new practice on the free trial, with no password until the person sets one via "Forgot password".
 */
import { and, eq } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { db } from "./db/client";
import { memberships, practices, users } from "./db/schema";
import { appEnv, appUrl } from "./env";
import { hmacHex, newWrappedDataKey, randomToken, toB64url, fromB64 } from "./crypto";
import { createSession } from "./session";
import { audit, clientIp } from "./security";
import { underLimit } from "./rate-limit";
import { approveAdmins } from "./maintenance";

const COOKIE = "__Host-folio_oauth";
const TRIAL_DAYS = 30;

export function googleEnabled(): boolean {
  const e = appEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  return `${appUrl()}/auth/google/callback`;
}

async function sign(value: string): Promise<string> {
  return `${value}.${await hmacHex(appEnv().SESSION_SECRET, `oauth:${value}`)}`;
}

async function unsign(signed: string | undefined): Promise<string | null> {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return (await sign(value)) === signed ? value : null;
}

/** Redirect to Google's sign-in page. */
export async function startGoogle(): Promise<Response> {
  if (!googleEnabled()) return Response.redirect(`${appUrl()}/login`, 302);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  setCookie(COOKIE, await sign(`${state}~${verifier}`), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: appEnv().GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

type Claims = { iss: string; aud: string; exp: number; email?: string; email_verified?: boolean; name?: string };

function fail(reason: string): Response {
  return new Response(null, { status: 302, headers: { location: `${appUrl()}/login?error=${encodeURIComponent(reason)}` } });
}

/** Google sends the person back here. */
export async function finishGoogle(request: Request): Promise<Response> {
  if (!googleEnabled()) return fail("google_off");
  if (!(await underLimit(`google:${clientIp()}`, 30, 900))) return fail("too_many");
  const url = new URL(request.url);
  const saved = await unsign(getCookie(COOKIE));
  deleteCookie(COOKIE, { path: "/", secure: true });
  const [state, verifier] = saved?.split("~") ?? [];
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return fail("google_expired");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: appEnv().GOOGLE_CLIENT_ID!,
      client_secret: appEnv().GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail("google_failed");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  const payload = id_token?.split(".")[1];
  if (!payload) return fail("google_failed");
  const claims = JSON.parse(new TextDecoder().decode(fromB64(payload))) as Claims;
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== appEnv().GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now()) return fail("google_failed");
  if (!claims.email || claims.email_verified !== true) return fail("google_unverified");
  const email = claims.email.toLowerCase();

  let [user] = await db().select().from(users).where(eq(users.email, email));
  if (!user) {
    const practiceId = crypto.randomUUID();
    const name = (claims.name ?? email.split("@")[0]!).slice(0, 100);
    user = await db().transaction(async (tx) => {
      await tx.insert(practices).values({
        id: practiceId,
        name: `${name}'s practice`.slice(0, 120),
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000),
        dataKeyWrapped: await newWrappedDataKey(appEnv().MASTER_KEY, practiceId),
      });
      // "!" is never a valid hash: no password until the person sets one.
      const [u] = await tx.insert(users).values({ email, name, passwordHash: "!", emailVerifiedAt: new Date() }).returning();
      await tx.insert(memberships).values({ practiceId, userId: u!.id, role: "owner" });
      return u!;
    });
    await audit(practiceId, user.id, "practice.created", { meta: { via: "google" } });
  } else if (!user.emailVerifiedAt) {
    // Google has confirmed this person owns the address.
    await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  }
  await approveAdmins(appEnv().PLATFORM_ADMIN_EMAILS ?? "", true);

  const [membership] = await db()
    .select({ practiceId: memberships.practiceId, requireTotp: practices.requireTotp })
    .from(memberships)
    .innerJoin(practices, eq(practices.id, memberships.practiceId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.active, true)))
    .orderBy(memberships.createdAt)
    .limit(1);
  await createSession(user.id, membership?.practiceId ?? null, false);
  const next = user.totpEnabledAt ? "/two-factor" : membership?.requireTotp ? "/two-factor/setup" : "/app";
  if (next === "/app") await audit(membership?.practiceId ?? null, user.id, "user.signed_in", { meta: { via: "google" } });
  return new Response(null, { status: 302, headers: { location: `${appUrl()}${next}` } });
}
