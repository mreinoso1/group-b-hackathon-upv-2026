import { describe, expect, it } from "vitest";
import { groupMilestones, placeLabel } from "../src/charts/Chart.tsx";
import { money, moneyShort } from "../src/format.ts";

describe("money labels never change a figure", () => {
  it.each([
    [150000, "$150k"],
    [1250000, "$1.25M"],
    [2000000, "$2M"],
    [46530, "$46,530"],
    [84577.5, "$84,577.50"],
    [3612345, "$3,612,345"],
    [-33615, "-$33,615"],
  ])("%s → %s", (n, label) => {
    expect(moneyShort(n)).toBe(label);
  });

  it("shows cents only when the plan has them", () => {
    expect(money(150800)).toBe("$150,800");
    expect(money(4609.22)).toBe("$4,609.22");
  });
});

describe("placeLabel", () => {
  it("goes right when there is room, left otherwise", () => {
    expect(placeLabel(10, "short").anchor).toBe("start");
    expect(placeLabel(330, "a much longer label").anchor).toBe("end");
  });
  it("stays inside the chart when neither side fits", () => {
    const p = placeLabel(170, "x".repeat(40));
    expect(p.anchor).toBe("start");
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 40 * 6.6).toBeLessThanOrEqual(340);
  });
});

describe("groupMilestones", () => {
  it("merges events of the same year into one row", () => {
    const rows = groupMilestones([
      { date: "2048-03-01", year: 2048, type: "RETIREMENT", label: "Melanie's Retirement", distress: false },
      { date: "2048-04-01", year: 2048, type: "RETIREMENT", label: "Timothy's Retirement", distress: false },
      { date: "2053-02-01", year: 2053, type: "BANKRUPTCY_ZEROCASH", label: "Savings projected to run out", distress: true },
    ]);
    expect(rows).toEqual([
      { year: 2048, label: "Melanie's Retirement, Timothy's Retirement", distress: false, icon: "retirement" },
      { year: 2053, label: "Savings projected to run out", distress: true, icon: "notice" },
    ]);
  });
});
