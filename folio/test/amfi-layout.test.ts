/** AMFI's NAVAll.txt since 2026: separate Plan and Option columns (lines as published on 27 Oct 2026). */
import { describe, expect, it } from "vitest";
import { parseNavAll } from "@/lib/amfi";

const NEW_LAYOUT = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  " ",
  "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
  " ",
  "HDFC Mutual Fund",
  " ",
  "118955;INF179K01UT0;-;HDFC Flexi Cap Fund;Direct Plan;Growth Option;2152.609;27-Oct-2026",
  "101762;INF179K01608;-;HDFC Flexi Cap Fund;Regular Plan;Growth Option;1952.877;27-Oct-2026",
  "118954;INF179K01VL5;INF179K01VM3;HDFC Flexi Cap Fund;Direct Plan;IDCW Option;87.038;27-Oct-2026",
  "101763;INF179K01582;INF179K01590;HDFC Flexi Cap Fund;Regular Plan;IDCW Option;70.568;27-Oct-2026",
  "100001;INF000000001;-;Old Style Fund - Growth;-;-;N.A.;27-Oct-2026",
].join("\r\n");

describe("NAVAll.txt with Plan and Option columns", () => {
  const rows = parseNavAll(NEW_LAYOUT);

  it("reads the NAV and date from their own columns", () => {
    const r = rows.find((x) => x.amfiCode === "101762")!;
    expect(r.nav).toBe("1952.877");
    expect(r.navDate).toBe("2026-10-27");
    expect(r.category).toBe("Equity Scheme - Flexi Cap Fund");
    expect(r.amc).toBe("HDFC Mutual Fund");
  });

  it("keeps plan and option in the name, so a scheme's four rows stay apart", () => {
    expect(rows.slice(0, 4).map((r) => [r.name, r.plan, r.option])).toEqual([
      ["HDFC Flexi Cap Fund - Direct Plan - Growth Option", "direct", "growth"],
      ["HDFC Flexi Cap Fund - Regular Plan - Growth Option", "regular", "growth"],
      ["HDFC Flexi Cap Fund - Direct Plan - IDCW Option", "direct", "idcw_payout"],
      ["HDFC Flexi Cap Fund - Regular Plan - IDCW Option", "regular", "idcw_payout"],
    ]);
  });

  it("leaves out empty plan and option cells, and a missing NAV stays missing", () => {
    const r = rows.find((x) => x.amfiCode === "100001")!;
    expect(r.name).toBe("Old Style Fund - Growth");
    expect(r.nav).toBeNull();
  });
});
