/**
 * FundVault on phones. Android: a small app (APK) downloaded from this site, which opens Folio full-screen.
 * iPhone: Apple allows no downloads outside the App Store, so the site is added to the Home Screen instead.
 * Shown once as a popup on phones (until dismissed), and always on /get-app.
 */
import { Link } from "@tanstack/react-router";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

export const APK_URL = "/downloads/FundVault.apk";
const DISMISS_KEY = "fundvault-popup-dismissed";
const IN_APP_KEY = "fundvault-in-app";

export type Platform = "android" | "ios" | "desktop" | "installed";

/** Where this page is running. Null until known (the server can't tell). */
export function usePlatform(): Platform | null {
  const [p, setP] = useState<Platform | null>(null);
  useEffect(() => {
    try {
      if (document.referrer.startsWith("android-app://com.anqulas.fundvault")) sessionStorage.setItem(IN_APP_KEY, "1");
    } catch {
      /* storage blocked */
    }
    let inApp = false;
    try {
      inApp = sessionStorage.getItem(IN_APP_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setP(inApp || standalone ? "installed" : /Android/.test(ua) ? "android" : ios ? "ios" : "desktop");
  }, []);
  return p;
}

export function AndroidSteps() {
  return (
    <div className="space-y-3">
      <a href={APK_URL} download="FundVault.apk" className="inline-flex h-11 items-center gap-2 rounded-full bg-text px-5 text-[15px] font-medium text-paper">
        <Download size={17} aria-hidden /> Download FundVault for Android
      </a>
      <ol className="list-decimal space-y-1 pl-5 text-[15px] text-muted">
        <li>Open the downloaded <b className="text-text">FundVault.apk</b> (from the notification or Downloads).</li>
        <li>If asked, allow your browser to <b className="text-text">install unknown apps</b>, then go back.</li>
        <li>
          Tap <b className="text-text">Install</b>, then <b className="text-text">Open</b>. Sign in once; it stays signed in.
        </li>
      </ol>
      <p className="text-[13px] text-muted">If Play Protect warns that it doesn't recognise the app, choose "Install anyway": it isn't from the Play Store yet.</p>
    </div>
  );
}

export function IosSteps() {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-muted">
      <li>Open this page in <b className="text-text">Safari</b>.</li>
      <li>
        Tap <Share size={15} className="inline align-[-2px]" aria-label="Share" /> <b className="text-text">Share</b> at the bottom.
      </li>
      <li>
        Choose <SquarePlus size={15} className="inline align-[-2px]" aria-hidden /> <b className="text-text">Add to Home Screen</b>, then{" "}
        <b className="text-text">Add</b>. FundVault appears with your other apps and opens full-screen.
      </li>
    </ol>
  );
}

/** The one-time popup on phones, inside the app. */
export function GetAppPopup() {
  const platform = usePlatform();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (platform !== "android" && platform !== "ios") return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* show it anyway */
    }
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [platform]);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      /* fine */
    }
  };
  return (
    <div role="dialog" aria-label="Get the FundVault app" className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:hidden">
      <div className="reveal mx-auto max-w-md rounded-2xl bg-card p-5 shadow-[0_18px_40px_-16px_rgb(30_41_35/0.45)] ring-1 ring-line">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-192.png" alt="" className="size-11 rounded-xl" />
            <div>
              <p className="font-semibold">Get the FundVault app</p>
              <p className="text-[13px] text-muted">Your clients and SIPs, one tap away.</p>
            </div>
          </div>
          <button type="button" aria-label="Not now" onClick={close} className="rounded-lg p-1.5 text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="mt-4">{platform === "android" ? <AndroidSteps /> : <IosSteps />}</div>
        <div className="mt-3 flex justify-between text-[13px]">
          <button type="button" onClick={close} className="font-medium text-muted">
            Not now
          </button>
          <Link to="/get-app" onClick={close} className="font-medium text-bronze">
            More help
          </Link>
        </div>
      </div>
    </div>
  );
}
