import { Capacitor } from "@capacitor/core";

/** True when running inside the installed Android app (Capacitor), false in a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Public web address used in links that leave the app (e-mail confirmation, password reset).
 * Inside the Android app `window.location.origin` is `https://localhost`, which would make
 * those e-mailed links point nowhere, so the app uses the published site instead.
 */
export function publicOrigin(): string {
  const configured = import.meta.env["VITE_PUBLIC_SITE_URL"] as string | undefined;
  if (isNativeApp() && configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
}

/**
 * Save a generated file. In a browser this triggers a normal download. Android WebViews
 * ignore download links, so in the app the file is written to the app cache and the system
 * share sheet opens, letting the user save it to Files/Drive or send it on WhatsApp/e-mail.
 */
export async function saveFile(data: Blob, fileName: string): Promise<void> {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: await blobToBase64(data),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: `Save or share ${fileName}` });
  } catch (error) {
    // Closing the share sheet without picking an app is not an error worth reporting.
    if (error instanceof Error && /cancel/i.test(error.message)) return;
    throw error;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Inline script for the page <head>. Inside the Android app the bundled page always opens
 * at "/", and redirecting from there while the page starts up makes React redo the first
 * render. This picks the first screen up front instead: the dashboard when a saved login
 * exists, otherwise the sign-in screen. In a normal browser it does nothing.
 */
export const NATIVE_START_SCRIPT = `(function () {
  try {
    if (!window.androidBridge || location.pathname !== "/") return;
    var signedIn = Object.keys(localStorage).some(function (k) { return /^sb-.+-auth-token$/.test(k); });
    history.replaceState(history.state, "", signedIn ? "/dashboard" : "/auth");
  } catch (e) {}
})();`;
