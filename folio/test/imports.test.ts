/** Registrar files and CAS statements: readers and parsers (made-up data in test/fixtures/imports). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTables, readDelimited, TableError } from "@/lib/imports/tables";
import { readZip, ZipError } from "@/lib/imports/zip";
import { detectRegistrar, readFeed } from "@/lib/imports/feed";
import { classify, parseDate, parseNumber } from "@/lib/imports/normalise";
import { casTransactions, parseCas } from "@/lib/imports/cas";
import { piecesToLines, type TextPiece } from "@/lib/imports/pdf-lines";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/imports/${name}`, import.meta.url)));

describe("reading dates, numbers and transaction types", () => {
  it("reads Indian date styles", () => {
    expect(parseDate("05/07/2025")).toBe("2025-07-05");
    expect(parseDate("05-Jul-2025")).toBe("2025-07-05");
    expect(parseDate("5 Jul 2025")).toBe("2025-07-05");
    expect(parseDate("20250705")).toBe("2025-07-05");
    expect(parseDate("2025-07-05")).toBe("2025-07-05");
    expect(parseDate("07/25/2025")).toBe("2025-07-25"); // can't be day-first
    expect(parseDate("05/07/2025 00:00:00")).toBe("2025-07-05");
    expect(parseDate("31/02/2025x")).toBeNull();
  });
  it("reads amounts with commas and brackets", () => {
    expect(parseNumber("1,23,456.78")).toBe(123456.78);
    expect(parseNumber("(3,500.00)")).toBe(-3500);
    expect(parseNumber("-2.5")).toBe(-2.5);
    expect(parseNumber("INR 1,876.54")).toBe(1876.54);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("N.A.")).toBeNull();
  });
  it("classifies by description, code and the sign of units", () => {
    expect(classify("Systematic Investment", "SIN", 1)).toBe("sip");
    expect(classify("SIP Purchase - Instalment 3/12", "", 1)).toBe("sip");
    expect(classify("Purchase", "P", 1)).toBe("purchase");
    expect(classify("", "NEW", 1)).toBe("purchase");
    expect(classify("Redemption", "R", -1)).toBe("redemption");
    expect(classify("", "RED", 2)).toBe("redemption");
    expect(classify("Switch Out - To Liquid Fund", "SO", -1)).toBe("switch_out");
    expect(classify("Switch-In From Equity Fund", "", 1)).toBe("switch_in");
    expect(classify("S T P In (Systematic Transfer)", "", 1)).toBe("switch_in");
    expect(classify("IDCW Reinvestment @ Rs.0.50 per unit", "", 1)).toBe("idcw_reinvest");
    expect(classify("IDCW Paid @ Rs.0.50 per unit", "", null)).toBe("idcw_payout");
    expect(classify("*** Stamp Duty ***", "", null)).toBeNull();
    expect(classify("TDS Deducted", "TDS", 0)).toBeNull();
    expect(classify("***Registration of Nominee***", "", null)).toBeNull();
    expect(classify("Something", "", -3)).toBe("redemption");
  });
});

describe("opening files", () => {
  it("opens a password-protected ZIP only with the right password", async () => {
    const zip = fixture("cams-feed.zip");
    const [entry] = readZip(zip);
    expect(entry).toMatchObject({ name: "cams-feed.csv", encrypted: true });
    await expect(entry!.read()).rejects.toMatchObject({ code: "password_needed" });
    await expect(entry!.read("wrong")).rejects.toBeInstanceOf(ZipError);
    const text = new TextDecoder().decode(await entry!.read("folio123"));
    expect(text).toBe(new TextDecoder().decode(fixture("cams-feed.csv")));
  });
  it("opens WinZip AES ZIPs (as CAMS sends them), 256 and 128 bit, large ones too", async () => {
    const [aes] = readZip(fixture("cams-feed-aes256.zip"));
    await expect(aes!.read()).rejects.toMatchObject({ code: "password_needed" });
    await expect(aes!.read("wrong")).rejects.toMatchObject({ code: "wrong_password" });
    expect(new TextDecoder().decode(await aes!.read("folio123"))).toBe(new TextDecoder().decode(fixture("cams-feed.csv")));
    const [big] = await readTables("cams-big-aes128.zip", fixture("cams-big-aes128.zip"), "folio123");
    expect(big!.rows).toHaveLength(1200);
    expect(big!.rows[1199]!["TRXNNO"]).toBe("91199");
  });
  it("refuses an AES ZIP whose data was altered", async () => {
    const bytes = fixture("cams-feed-aes256.zip").slice();
    bytes[80] = bytes[80]! ^ 0xff; // inside the encrypted data
    const [e] = readZip(bytes);
    await expect(e!.read("folio123")).rejects.toBeInstanceOf(ZipError);
  });
  it("reads the same report from CSV, ZIP and DBF alike", async () => {
    const csv = (await readTables("cams-feed.csv", fixture("cams-feed.csv")))[0]!.rows;
    const zip = (await readTables("cams-feed.zip", fixture("cams-feed.zip"), "folio123"))[0]!.rows;
    const dbf = (await readTables("cams-feed.dbf", fixture("cams-feed.dbf")))[0]!.rows;
    expect(zip).toEqual(csv);
    expect(dbf).toHaveLength(csv.length);
    expect(dbf[0]).toMatchObject({ FOLIO_NO: "1234567/89", TRADDATE: "2025-04-01", AMOUNT: "15000.0000" });
  });
  it("reads an Excel report, skipping a title row, with real dates", async () => {
    const [t] = await readTables("kfin-feed.xlsx", fixture("kfin-feed.xlsx"));
    expect(t!.rows).toHaveLength(3);
    expect(t!.rows[0]).toMatchObject({ TD_ACNO: "3344556677", TD_TRDT: "2025-08-01", PAN1: "ZZRPK1001A", TD_AMT: "100000" });
  });
  it("reads pipe- and tilde-separated text", () => {
    expect(readDelimited("A|B|C|D\n1|2|3|4\n")).toEqual([{ A: "1", B: "2", C: "3", D: "4" }]);
    expect(readDelimited("A~B~C~D\r\n1~2~3~4")).toEqual([{ A: "1", B: "2", C: "3", D: "4" }]);
  });
  it("explains an old .xls file", async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(readTables("report.xls", xls)).rejects.toBeInstanceOf(TableError);
  });
});

describe("registrar reports", () => {
  it("reads a CAMS report: types, signs, reversals; skips taxes and rejected rows", async () => {
    const rows = (await readTables("cams-feed.csv", fixture("cams-feed.csv")))[0]!.rows;
    expect(detectRegistrar(Object.keys(rows[0]!))).toBe("cams");
    const r = readFeed(rows);
    expect(r.missing).toEqual([]);
    expect(r.txns.map((t) => [t.type, t.date, t.amount, t.units])).toEqual([
      ["purchase", "2025-04-01", 15000, 10],
      ["sip", "2025-05-05", 3000, 1.95],
      ["redemption", "2025-10-10", 3500, 2],
      ["sip", "2025-06-05", -3000, -2],
      ["sip", "2025-07-05", 5000, 62.5],
    ]);
    expect(r.txns[0]).toMatchObject({ folio: "1234567/89", pan: "ZZRPK1001A", investorName: "RAMESH KUMAR", arn: "ARN-12345", amc: "HDFC", nav: 1500, rtaCode: "H02G" });
    expect(r.skipped.map((s) => s.reason)).toEqual(["Not an investment or redemption (tax, stamp duty, or a detail change)", "Rejected or cancelled by the registrar"]);
    // Re-reading gives the same ids: a file sent twice is imported once.
    expect(readFeed(rows).txns.map((t) => t.ref)).toEqual(r.txns.map((t) => t.ref));
  });
  it("reads a KFintech report from Excel, with ISINs", async () => {
    const rows = (await readTables("kfin-feed.xlsx", fixture("kfin-feed.xlsx")))[0]!.rows;
    const r = readFeed(rows);
    expect(r.source).toBe("kfintech");
    expect(r.txns.map((t) => [t.type, t.date, t.amount, t.units, t.isin])).toEqual([
      ["purchase", "2025-08-01", 100000, 250, "INF209K01VF2"],
      ["redemption", "2025-09-01", 20250, 50, "INF209K01VF2"],
      ["switch_out", "2025-09-15", 4060, 10, "INF209K01VF2"],
    ]);
  });
  it("names the columns a report lacks", () => {
    const r = readFeed([{ NAME: "x", PAN: "y", FOO: "1", BAR: "2" }]);
    expect(r.missing).toEqual(["folio number", "scheme name", "transaction date", "amount", "transaction type"]);
  });
});

describe("CAS statements", () => {
  const LINES = [
    "Consolidated Account Statement",
    "01-Apr-2025 To 24-Oct-2026",
    "Email Id: ramesh.sample@example.com",
    "Ramesh Kumar",
    "HDFC Mutual Fund",
    "Folio No: 1234567 / 89\tPAN: ZZRPK1001A\tKYC: OK  PAN: OK",
    "H02G-HDFC Flexi Cap Fund - Growth Plan (Advisor: ARN-12345) Registrar : CAMS",
    "ISIN: INF179K01608",
    "Date\tTransaction\tAmount\tUnits\tPrice\tUnit",
    "Opening Unit Balance: 0.000",
    "01-Apr-2025\tPurchase\t15,000.00\t10.000\t1,500.00\t10.000",
    "01-Apr-2025\t*** Stamp Duty ***\t0.75",
    "05-May-2025\tSystematic Investment\t3,000.00\t1.950\t1,538.46\t11.950",
    "10-Oct-2025\tRedemption\t(3,500.00)\t(2.000)\t1,750.00\t9.950",
    "Closing Unit Balance: 9.950\tNAV on 24-Oct-2026: INR 1,876.543",
    "Total Cost Value: 15,000.00\tMarket Value on 24-Oct-2026: INR 18,671.60",
    "PPFAS Mutual Fund",
    "Folio No: 9988776\tPAN: ZZRPK1001A",
    "PP01RG-Parag Parikh Flexi Cap Fund - Regular Plan - Growth (Advisor: ARN-99999)",
    "Registrar : CAMS  ISIN: INF879O01019",
    "Opening Unit Balance: 0.000",
    "05-Jun-2025\tSIP Purchase - Instalment 1/12\t5,000.00\t64.103\t78.00\t64.103",
    "05-Jul-2025\tSIP Purchase - Instalment 2/12\t5,000.00\t62.500\t80.00\t126.603",
    "Closing Unit Balance: 126.603\tNAV on 24-Oct-2026: INR 84.1234",
  ];
  it("reads folios, schemes and transactions, checked against the closing balance", () => {
    const r = parseCas(LINES);
    expect(r).toMatchObject({ investorName: "Ramesh Kumar", email: "ramesh.sample@example.com", period: { from: "2025-04-01", to: "2026-10-24" }, warnings: [] });
    expect(r.schemes.map((s) => [s.folio, s.amc, s.scheme, s.isin, s.advisor, s.registrar, s.close, s.balanced])).toEqual([
      ["1234567/89", "HDFC Mutual Fund", "HDFC Flexi Cap Fund - Growth Plan", "INF179K01608", "ARN-12345", "CAMS", 9.95, true],
      ["9988776", "PPFAS Mutual Fund", "Parag Parikh Flexi Cap Fund - Regular Plan - Growth", "INF879O01019", "ARN-99999", "CAMS", 126.603, true],
    ]);
    expect(r.schemes[0]!.txns.map((t) => [t.type, t.date, t.amount, t.units, t.nav])).toEqual([
      ["purchase", "2025-04-01", 15000, 10, 1500],
      ["sip", "2025-05-05", 3000, 1.95, 1538.46],
      ["redemption", "2025-10-10", 3500, 2, 1750],
    ]);
    expect(r.schemes[0]).toMatchObject({ nav: 1876.543, navDate: "2026-10-24", value: 18671.6, cost: 15000 });
    expect(casTransactions(r)).toHaveLength(5);
  });
  it("leaves out a scheme whose rows don't add up, and says so", () => {
    const broken = LINES.map((l) => (l.startsWith("05-May-2025") ? "05-May-2025\tSystematic Investment\t3,000.00\t1.950\t1,538.46\t12.950" : l)).map((l) =>
      l.startsWith("10-Oct-2025") ? "10-Oct-2025\tRedemption\t(3,500.00)\t(2.000)\t1,750.00\t10.950" : l,
    );
    const r = parseCas(broken.map((l) => (l.startsWith("Closing Unit Balance: 9.950") ? l.replace("9.950", "9.000") : l)));
    expect(r.schemes[0]!.balanced).toBe(false);
    expect(r.warnings.some((w) => w.includes("left out"))).toBe(true);
    expect(casTransactions(r).every((t) => t.folio === "9988776")).toBe(true);
  });
  it("trusts the printed balance for the sign of a bracketed reversal", () => {
    const lines = [
      "Folio No: 55\tPAN: ZZRPK1001A",
      "X1-Some Fund - Growth Registrar : KFINTECH",
      "Opening Unit Balance: 10.000",
      "02-Jan-2026\tPurchase\t1,000.00\t5.000\t200.00\t15.000",
      "03-Jan-2026\tPurchase - Reversed\t(1,000.00)\t(5.000)\t200.00\t10.000",
      "Closing Unit Balance: 10.000",
    ];
    const r = parseCas(lines);
    expect(r.schemes[0]!.txns.map((t) => [t.type, t.amount, t.units])).toEqual([
      ["purchase", 1000, 5],
      ["purchase", -1000, -5],
    ]);
    expect(r.schemes[0]!.registrar).toBe("KFINTECH");
  });
  it("joins PDF text pieces into lines, with tabs between columns", () => {
    const pieces: TextPiece[] = [
      { str: "Purchase", x: 110, y: 700, width: 35 },
      { str: "01-Apr-2025", x: 40, y: 700.5, width: 50 },
      { str: "15,000.00", x: 350, y: 700, width: 40 },
      { str: "Folio No:", x: 40, y: 720, width: 38 },
      { str: "1234567", x: 79, y: 720, width: 30 },
    ];
    expect(piecesToLines(pieces)).toEqual(["Folio No: 1234567", "01-Apr-2025\tPurchase\t15,000.00"]);
  });
  it("reads the sample statement PDF end to end (password-protected)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    await expect(pdfjs.getDocument({ data: fixture("cas-sample.pdf") }).promise).rejects.toMatchObject({ name: "PasswordException" });
    const doc = await pdfjs.getDocument({ data: fixture("cas-sample.pdf"), password: "ZZRPK1001A" }).promise;
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const pieces = content.items.flatMap((i) => ("str" in i ? [{ str: i.str, x: i.transform[4] as number, y: i.transform[5] as number, width: i.width }] : []));
      lines.push(...piecesToLines(pieces));
    }
    const r = parseCas(lines);
    expect(r.warnings).toEqual([]);
    expect(r.schemes.map((s) => [s.scheme, s.isin, s.close, s.balanced, s.txns.length])).toEqual([
      ["HDFC Flexi Cap Fund - Growth Plan", "INF179K01608", 9.95, true, 3],
      ["Parag Parikh Flexi Cap Fund - Regular Plan - Growth", "INF879O01019", 126.603, true, 2],
    ]);
  });
});
