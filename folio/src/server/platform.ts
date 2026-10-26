/**
 * The platform admin (you). Allowed only for emails in PLATFORM_ADMIN_EMAILS, after the authenticator step,
 * within 12 hours of it. Anyone else gets "not found", so the page's existence isn't revealed.
 */
import { notFound } from "@tanstack/react-router";
import { getSession } from "./session";
import { appEnv } from "./env";

const FRESH_MS = 12 * 3600 * 1000;

export async function requirePlatformAdmin(): Promise<{ email: string; userId: string }> {
  const s = await getSession();
  const admins = (appEnv().PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!s || !s.mfaPassed || !admins.includes(s.email) || Date.now() - s.createdAt.getTime() > FRESH_MS) {
    throw notFound();
  }
  return { email: s.email, userId: s.userId };
}
