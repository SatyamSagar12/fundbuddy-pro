/** Sending through Resend: the request it makes, and a refused send. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailWorks, sendMail } from "@/server/mailer";

const env = process.env as Record<string, string | undefined>;
afterEach(() => {
  vi.unstubAllGlobals();
  delete env["RESEND_API_KEY"];
  delete env["MAIL_FROM"];
});

describe("mailer", () => {
  it("sends through Resend when its key is set", async () => {
    env["MASTER_KEY"] ??= "x".repeat(44);
    env["SESSION_SECRET"] ??= "x".repeat(44);
    env["RESEND_API_KEY"] = "re_test_key";
    env["MAIL_FROM"] = "Anqulas Folio <no-reply@anqulas.com>";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(emailWorks()).toBe(true);
    expect(await sendMail({ to: "father@example.com", subject: "Hi", text: "Body" })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init.body))).toEqual({ from: "Anqulas Folio <no-reply@anqulas.com>", to: ["father@example.com"], subject: "Hi", text: "Body" });
  });

  it("reports a refused send", async () => {
    env["RESEND_API_KEY"] = "re_test_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domain not verified", { status: 403 })));
    await expect(sendMail({ to: "a@example.com", subject: "x", text: "y" })).rejects.toThrow(/Resend send failed: 403/);
  });
});
