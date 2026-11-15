import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agreement, futureSelves, gerund, LocalCaseSource, planPriorities, suggestPriority, TOPICS } from "../src/index.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const get = async (id: string) => source.getCase(id);
const TODAY = new Date("2026-11-15");

describe("planPriorities", () => {
  it("every family's recommendations get a plain label and a capsule", async () => {
    for (const id of await source.listIds()) {
      const ps = planPriorities(await get(id));
      expect(ps).toHaveLength(5);
      for (const p of ps) {
        expect(p.label.length, `${id}: ${p.text}`).toBeLessThan(45);
        expect(p.text).toMatch(/\.$/);
        expect(TOPICS.some((t) => t.id === p.topicId)).toBe(true);
      }
    }
  });

  it("names Samantha's and Michael's priorities for what they are", async () => {
    expect(planPriorities(await get("samantha-lewis")).map((p) => p.label)).toEqual([
      "Keep your protection in place",
      "Balance retirement and college saving",
      "Open a tax-advantaged account",
      "Check for a workplace retirement plan",
      "Plan cash for the near-term bills",
    ]);
    expect(planPriorities(await get("michael-carter"))[2]!.label).toBe("Review your life and umbrella cover");
  });

  it("shows the plan's score effect only where the plan scores a matching move", async () => {
    const weah = planPriorities(await get("timothy-melanie-weah"));
    expect(weah[2]).toMatchObject({ label: "Pay down the credit card", score: { before: 60, after: 62, liftsACap: true } });
    expect(weah[0]!.score).toMatchObject({ before: 60, after: 60, liftsACap: true, combo: { after: 78 } });
    expect(weah[0]!.score!.combo!.with).toEqual(["paying down your credit card", "adding umbrella insurance"]);
    expect(weah[3]).toMatchObject({ label: "Start saving for college" });
    expect(weah[3]!.score).toBeUndefined();
  });
});

describe("suggestPriority", () => {
  it("always keeps the plan's order, even when savings run out", async () => {
    for (const id of ["timothy-melanie-weah", "michael-carter", "samantha-lewis"]) {
      expect(suggestPriority(planPriorities(await get(id)))).toEqual({ index: 0, because: "plan_order" });
    }
    const michael = planPriorities(await get("michael-carter"));
    expect(michael[0]!.label).toBe("Plan the home purchase with your cash");
    // His cash flow is negative: the plan says to weigh retirement saving, not to save more.
    expect(michael.map((p) => p.label)).toContain("Weigh retirement saving against cash flow");
    expect(michael.map((p) => p.label)).not.toContain("Save more for retirement");
  });
});

describe("gerund", () => {
  it("reads inside a sentence", () => {
    expect(gerund("Pay down your credit card")).toBe("paying down your credit card");
    expect(gerund("Add umbrella insurance")).toBe("adding umbrella insurance");
  });
});

describe("agreement", () => {
  const couple = [
    { id: "timothy", name: "Timothy" },
    { id: "melanie", name: "Melanie" },
  ];

  it("waits until both have ordered, and is not used for people who live alone", async () => {
    const ps = planPriorities(await get("timothy-melanie-weah"));
    expect(agreement(ps, couple, { timothy: [2, 0, 1, 3, 4] }).status).toBe("waiting");
    expect(agreement(ps, couple, { timothy: [2, 0, 1, 3, 4] }).waitingFor).toEqual(["melanie"]);
    expect(agreement(ps, [{ id: "michael", name: "Michael" }], {}).status).toBe("single_member");
  });

  it("shows where they agree and where they don't, without ranking for them", async () => {
    const ps = planPriorities(await get("timothy-melanie-weah"));
    const a = agreement(ps, couple, { timothy: [2, 0, 1, 3, 4], melanie: [0, 3, 1, 4, 2] });
    expect(a.status).toBe("ready");
    expect(a.sharedFirst).toBe(0); // life cover: Timothy #2, Melanie #1
    expect(a.agreeOn).toEqual([0]);
    expect(a.seeDifferently).toEqual([2]); // the card: Timothy #1, Melanie #5
    expect(a.summary).toMatch(/You see "pay down the credit card" differently: Timothy #1, Melanie #5/);
    expect(a.summary).toMatch(/Timothy put "pay down the credit card" first and Melanie put "get the life cover you need" first/);
    expect(a.note).toMatch(/order you choose is yours/);
  });

  it("ignores orders that are not a full ranking", async () => {
    const ps = planPriorities(await get("timothy-melanie-weah"));
    expect(agreement(ps, couple, { timothy: [0, 0, 1, 2, 3], melanie: [0, 1, 2, 3, 4] }).waitingFor).toEqual(["timothy"]);
  });
});
