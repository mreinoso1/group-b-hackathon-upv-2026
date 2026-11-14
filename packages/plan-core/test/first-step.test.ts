import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkInLabel,
  checkNumbers,
  futureSelfLine,
  futureSelfNumbers,
  futureSelves,
  LocalCaseSource,
  planMoves,
  TOPICS,
  topicForMove,
} from "../src/index.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const ids = await source.listIds();
const cases = await Promise.all(ids.map((id) => source.getCase(id)));
const TODAY = new Date("2026-11-14");

describe("planMoves", () => {
  it("reads every family's top moves with their score effect", () => {
    for (const raw of cases) {
      const moves = planMoves(raw);
      expect(moves.length).toBeGreaterThan(0);
      for (const m of moves) {
        expect(TOPICS.some((t) => t.id === m.topicId)).toBe(true);
        expect(m.scoreAfter).toBeGreaterThanOrEqual(m.scoreBefore);
      }
    }
  });

  it("gives the Weahs' card paydown its plan figures and the combinations that include it", () => {
    const weah = planMoves(cases.find((c) => c.id === "timothy-melanie-weah")!);
    expect(weah[0]).toMatchObject({ title: "Pay down revolving card", effort: "medium", scoreBefore: 60, scoreAfter: 62, topicId: "advice.debt" });
    expect(weah[0]!.action).toContain("$6,800");
    expect(weah[0]!.combos[0]).toMatchObject({ scoreAfter: 78 });
    expect(weah[1]).toMatchObject({ title: "Add life cover", liftsACap: true, topicId: "advice.protection.life_insurance" });
  });

  it("maps moves to the capsule that explains them", () => {
    expect(topicForMove("Add umbrella cover")).toBe("advice.protection.umbrella");
    expect(topicForMove("Lower the withdrawal rate")).toBe("advice.retirement");
    expect(topicForMove("Raise growth allocation toward glide")).toBe("advice.investments");
  });
});

describe("future-self lines", () => {
  it("only use numbers the future self carries from the plan", () => {
    for (const raw of cases) {
      for (const f of futureSelves(raw, TODAY)) {
        for (const t of TOPICS) {
          const line = futureSelfLine(f, t.id);
          expect(checkNumbers(line, futureSelfNumbers(f)).ok, `${raw.id} ${t.id}: ${line}`).toBe(true);
        }
        expect(checkNumbers(f.introText, futureSelfNumbers(f)).ok).toBe(true);
      }
    }
  });

  it("speak honestly but hopefully when savings run out", () => {
    const michael = futureSelves(cases.find((c) => c.id === "michael-carter")!, TODAY)[0]!;
    expect(futureSelfLine(michael, "overview.score")).toMatch(/time to change that/);
    expect(michael.introText).not.toMatch(/This is the year our savings run out/);
  });
});

describe("checkInLabel", () => {
  it("names upcoming plan dates", () => {
    expect(checkInLabel({ date: "2030-01-01", year: 2030, type: "PURCHASE", subType: "REAL_ESTATE_PURCHASE", label: "Purchase a home", distress: false })).toBe(
      "Before your home purchase · Jan 2030",
    );
    expect(checkInLabel({ date: "2038-08-01", year: 2038, type: "COLLEGE", label: "College Liam", distress: false })).toBe(
      "Before college starts: College Liam · Aug 2038",
    );
  });
});
