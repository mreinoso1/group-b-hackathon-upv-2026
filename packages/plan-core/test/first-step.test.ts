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
  suggestMove,
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

describe("plain step titles", () => {
  it("every family's steps have a plain headline without jargon or numbers", () => {
    for (const raw of cases) {
      for (const m of planMoves(raw)) {
        expect(m.plainTitle, `${raw.id}: ${m.title}`).not.toMatch(/\d|gate|anchor|glide|mortality|revolving|integrity|band/i);
        expect(m.plainTitle).not.toBe(m.title);
      }
    }
  });
  it("reads naturally", () => {
    const weah = planMoves(cases.find((c) => c.id === "timothy-melanie-weah")!);
    expect(weah.map((m) => m.plainTitle)).toEqual(["Pay down your credit card", "Get more life insurance", "Add umbrella insurance"]);
    const samantha = planMoves(cases.find((c) => c.id === "samantha-lewis")!);
    expect(samantha[0]!.plainTitle).toBe("Insure your home");
  });
});

describe("suggestMove", () => {
  const get = (id: string) => cases.find((c) => c.id === id)!;
  it("keeps the plan's first step by default", () => {
    const raw = get("timothy-melanie-weah");
    expect(suggestMove(planMoves(raw), futureSelves(raw, TODAY)[0])).toEqual({ index: 0, because: "plan_order" });
  });
  it("starts with what makes savings last when the future self speaks from that year", () => {
    const raw = get("michael-carter");
    const moves = planMoves(raw);
    const s = suggestMove(moves, futureSelves(raw, TODAY)[0]);
    expect(s.because).toBe("future_self");
    expect(moves[s.index]).toMatchObject({ title: "Lower the withdrawal rate", scoreAfter: 62 });
  });
  it("falls back to the plan's order when no step is about savings", () => {
    const raw = get("samantha-lewis");
    expect(suggestMove(planMoves(raw), futureSelves(raw, TODAY)[0])).toEqual({ index: 0, because: "plan_order" });
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
    expect(futureSelfLine(michael, "overview.big_picture", true)).toMatch(/^Let's start, Michael\. This is the whole picture/);
    expect(michael.introText).not.toMatch(/This is the year our savings run out/);
  });
});

describe("checkInLabel", () => {
  it("names upcoming plan dates", () => {
    expect(checkInLabel({ date: "2030-01-01", year: 2030, type: "PURCHASE", subType: "REAL_ESTATE_PURCHASE", label: "Purchase a home", distress: false })).toBe(
      "Before your home purchase · Jan 2030",
    );
    expect(checkInLabel({ date: "2038-08-01", year: 2038, type: "COLLEGE", label: "College Liam", distress: false })).toBe(
      "Before Liam starts college · Aug 2038",
    );
    expect(checkInLabel({ date: "2044-05-01", year: 2044, type: "RETIREMENT", label: "Emily's Retirement", distress: false })).toBe(
      "Before Emily's retirement · May 2044",
    );
  });
});
