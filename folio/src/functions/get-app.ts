/** The "Get the app" page: a QR code of its own address, so a computer can hand it to a phone. */
import { createServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";
import { appUrl } from "@/server/env";

export const getAppPage = createServerFn({ method: "GET" }).handler(async () => {
  const url = `${appUrl()}/get-app`;
  return { url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, width: 180 }) };
});
