/** The branded statement PDF: branding, the AMFI disclaimer on every page, page breaks and safe text. */
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfSafe, rupees, statementPdf } from "@/lib/statement-pdf";
import { AMFI_DISCLAIMER, statementFileName, type StatementData } from "@/lib/statement";

async function pagesText(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((x) => ("str" in x ? x.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return out;
}

const base: StatementData = {
  practice: { name: "Verma Investments", arn: "ARN-123456", euin: "E654321" },
  title: "Sharma family",
  people: ["Asha Sharma", "Bharat Sharma"],
  isFamily: true,
  generatedOn: "2026-10-28",
  navDate: "2026-10-27",
  total: { value: 1234567, invested: 1000000, gain: 234567, returnLabel: "XIRR", returnValue: 0.1234 },
  holdings: [
    { scheme: "HDFC Flexi Cap Fund - Regular Plan - Growth Option", member: "Asha Sharma", units: 123.456, invested: 200000, value: 260000, gain: 60000, returnLabel: "XIRR", returnValue: 0.15, estimated: false },
    { scheme: "Parag Parikh Flexi Cap Fund - Regular Plan - Growth", member: "Bharat Sharma", units: 50, invested: 50000, value: 48000, gain: -2000, returnLabel: "Return", returnValue: -0.04, estimated: true },
  ],
  notValued: [{ scheme: "Some typed scheme", invested: 25000 }],
  sips: [{ scheme: "HDFC Flexi Cap Fund - Regular Plan - Growth Option", member: "Asha Sharma", amount: 5000, frequency: "monthly", since: "2022-01-05", status: "active" }],
  transactions: Array.from({ length: 90 }, (_, i) => ({
    date: `2026-${String(10 - Math.floor(i / 10)).padStart(2, "0")}-05`,
    scheme: "HDFC Flexi Cap Fund - Regular Plan - Growth Option",
    member: i % 2 ? "Asha Sharma" : "Bharat Sharma",
    type: "sip",
    amount: 5000,
    units: 2.561,
  })),
};

describe("statement PDF", () => {
  it("carries the practice's name, ARN and EUIN, the people and the figures", async () => {
    const [first] = await pagesText(await statementPdf(base));
    expect(first).toContain("Verma Investments");
    expect(first).toContain("ARN-123456");
    expect(first).toContain("EUIN E654321");
    expect(first).toContain("Sharma family");
    expect(first).toContain("Asha Sharma, Bharat Sharma");
    expect(first).toContain("Rs 12,34,567");
    expect(first).toContain("12.3%");
    expect(first).toContain("HDFC Flexi Cap Fund");
    expect(first).toContain("NOT VALUED YET");
    expect(first).toContain("27 Oct 2026");
  });

  it("puts the AMFI disclaimer and page numbers on every page, breaking long tables onto new pages", async () => {
    const pages = await pagesText(await statementPdf(base));
    expect(pages.length).toBeGreaterThan(1);
    for (const [i, p] of pages.entries()) {
      expect(p).toContain(AMFI_DISCLAIMER);
      expect(p).toContain(`Page ${i + 1} of ${pages.length}`);
    }
    // The table header repeats on the next page.
    expect(pages[1]).toMatch(/DATE SCHEME MEMBER TYPE AMOUNT UNITS/);
  });

  it("a single client's statement has no member column; an empty one still works", async () => {
    const one: StatementData = { ...base, title: "Asha Sharma", people: ["Asha Sharma"], isFamily: false, holdings: [], notValued: [], sips: [], transactions: [] };
    const [p] = await pagesText(await statementPdf(one));
    expect(p).toContain("No holdings yet.");
    expect(p).toContain("No SIPs.");
    expect(p).not.toContain("MEMBER");
  });

  it("names in other scripts don't break it", async () => {
    const bytes = await statementPdf({ ...base, title: "शर्मा परिवार", people: ["आशा"], practice: { ...base.practice, name: "Café ₹ Wealth" } });
    expect((await pagesText(bytes))[0]).toContain("Café Rs Wealth");
  });

  it("keeps text to what the built-in font can draw", () => {
    expect(pdfSafe("₹1,000 – “ok” ≈ आ")).toBe("Rs 1,000 – “ok” ~ ?");
    expect(rupees(-123456.7)).toBe("-Rs 1,23,457");
  });

  it("names the file after the client or family and the date", () => {
    expect(statementFileName(base)).toBe("sharma-family-statement-2026-10-28.pdf");
    expect(statementFileName({ title: "शर्मा", generatedOn: "2026-10-28" })).toBe("portfolio-statement-2026-10-28.pdf");
  });
});
