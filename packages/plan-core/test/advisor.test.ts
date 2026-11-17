import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { advisorBrief, LocalCaseSource, personaTensions, planPriorities, type PlanEvent } from "../src/index.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const weah = await source.getCase("timothy-melanie-weah");
const michael = await source.getCase("michael-carter");

let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 15, 10, 0, clock++)).toISOString();
const base = (member: string, caseId = weah.id) => ({ at: at(), caseId, member });
const react = (member: string, topicId: string, reaction: "got_it" | "lost" | "tell_me_more", level: "standard" | "simple" | "expert" = "standard", attempt?: number): PlanEvent => ({
  type: "reaction",
  ...base(member),
  topicId,
  level,
  reaction,
  ...(attempt !== undefined ? { attempt } : {}),
});
const consent = (member: string, share: boolean): PlanEvent => ({ type: "consent", ...base(member), share });
const question = (member: string, topicId: string, text: string): PlanEvent => ({ type: "question", ...base(member), topicId, text });
const ranking = (member: string, order: number[]): PlanEvent => ({ type: "ranking", ...base(member), order });

/** Melanie: score understood; lost twice on debt, then "Got it" on the one-number version; lost on life insurance and moved on. */
const melanieSession = (): PlanEvent[] => [
  react("melanie", "overview.score", "got_it"),
  react("melanie", "advice.debt", "lost"),
  react("melanie", "advice.debt", "lost", "simple", 0),
  react("melanie", "advice.debt", "got_it", "simple", 1),
  react("melanie", "advice.protection.life_insurance", "lost"),
  react("melanie", "advice.protection.life_insurance", "got_it", "standard"),
  react("melanie", "advice.protection.umbrella", "lost"),
  react("melanie", "advice.savings", "tell_me_more"),
];

describe("advisorBrief without consent", () => {
  it("shows nobody's taps, only the questions they sent", () => {
    const b = advisorBrief(weah, [...melanieSession(), question("timothy", "advice.debt", "Should we pay the card with our cash?")]);
    for (const p of b.people) {
      expect(p.shared).toBe(false);
      expect([...p.understood, ...p.stuck, ...p.wantedDepth, ...p.skipped, ...p.notReached]).toHaveLength(0);
      expect(p.firstStep).toBeNull();
    }
    expect(b.people.find((p) => p.memberId === "timothy")!.questions[0]!.text).toBe("Should we pay the card with our cash?");
    expect(b.couple?.status).toBe("not_shared");
    expect(b.agenda.map((a) => a.kind)).toEqual(["question"]);
    expect(b.alreadyUnderstood).toHaveLength(0);
  });
});

describe("advisorBrief for one person who shared", () => {
  const b = advisorBrief(weah, [consent("melanie", true), ...melanieSession()]);
  const mel = b.people.find((p) => p.memberId === "melanie")!;

  it("sorts each idea into understood, stuck (and what landed) and wanted depth", () => {
    expect(mel.understood.map((t) => t.topicId)).toEqual(["overview.score"]);
    const debt = mel.stuck.find((s) => s.topicId === "advice.debt")!;
    expect(debt).toMatchObject({ lostCount: 2, resolved: true, landed: "one_number" });
    const umbrella = mel.stuck.find((s) => s.topicId === "advice.protection.umbrella")!;
    expect(umbrella).toMatchObject({ lostCount: 1, resolved: false, landed: null });
    expect(mel.wantedDepth.map((t) => t.topicId)).toEqual(["advice.savings"]);
  });

  it("knows what was skipped and what was not reached, in her own order", () => {
    expect(mel.skipped.map((t) => t.topicId)).toContain("overview.big_picture");
    expect(mel.notReached.map((t) => t.topicId)).toContain("advice.priorities");
  });

  it("puts unresolved 'I'm lost' first on the agenda, citing the events", () => {
    const first = b.agenda[0]!;
    expect(first.kind).toBe("lost");
    expect(first.title).toMatch(/Umbrella/);
    expect(first.evidence.every((e) => e.type === "reaction" && e.member === "melanie" && e.topicId === "advice.protection.umbrella")).toBe(true);
  });

  it("keeps every open item: a fourth 'I'm lost' never pushes an earlier one off", () => {
    const topics = ["advice.debt", "advice.protection.life_insurance", "advice.protection.umbrella", "advice.savings", "advice.retirement"];
    const b2 = advisorBrief(weah, [consent("melanie", true), ...topics.map((t) => react("melanie", t, "lost"))]);
    expect(b2.agenda.map((a) => a.evidence[0]!.topicId)).toEqual(topics);
  });

  it("flags when the persona predicted it", () => {
    // Weah T1: idle cash next to the life insurance shortfall and no umbrella.
    expect(b.agenda[0]!.personaPredicted?.id).toBe("T1");
  });

  it("keeps Timothy private and the couple section closed until both share", () => {
    expect(b.people.find((p) => p.memberId === "timothy")!.shared).toBe(false);
    expect(b.couple?.status).toBe("not_shared");
  });

  it("counts ideas to skip in the meeting, never ones someone got stuck on", () => {
    expect(b.alreadyUnderstood.map((t) => t.topicId)).toEqual(["overview.score"]);
  });
});

describe("advisorBrief for a couple who both shared", () => {
  const n = planPriorities(weah).length;
  const melOrder = [...Array(n).keys()];
  const timOrder = [...melOrder].reverse();

  it("shows where they agree and differ, quoting the plan, and puts differences after unresolved losses", () => {
    const b = advisorBrief(weah, [consent("melanie", true), consent("timothy", true), ...melanieSession(), ranking("melanie", melOrder), ranking("timothy", timOrder)]);
    expect(b.couple?.status).toBe("ready");
    const diff = b.couple!.seeDifferently[0]!;
    expect(diff.planSays).toBe(planPriorities(weah)[diff.index]!.text);
    expect(diff.ranks.map((r) => r.name)).toEqual(["Timothy", "Melanie"]);
    expect(b.agenda.map((a) => a.kind)).toEqual(["lost", "couple", "couple"]);
  });

  it("waits for the partner who has not ranked", () => {
    const b = advisorBrief(weah, [consent("melanie", true), consent("timothy", true), ranking("melanie", melOrder)]);
    expect(b.couple).toMatchObject({ status: "waiting", waitingFor: ["Timothy"] });
  });

  it("includes reading together only when both shared", () => {
    const together = [react("together", "overview.score", "got_it")];
    expect(advisorBrief(weah, [consent("melanie", true), ...together]).people.find((p) => p.memberId === "together")!.shared).toBe(false);
    expect(advisorBrief(weah, [consent("melanie", true), consent("timothy", true), ...together]).people.find((p) => p.memberId === "together")!.shared).toBe(true);
  });

  it("the latest choice counts: sharing can be withdrawn", () => {
    const b = advisorBrief(weah, [consent("melanie", true), ...melanieSession(), consent("melanie", false)]);
    expect(b.people.find((p) => p.memberId === "melanie")!.stuck).toHaveLength(0);
  });
});

describe("personaTensions", () => {
  it("reads both persona formats, most severe first", () => {
    const t = personaTensions(weah);
    expect(t.map((x) => x.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(t[0]!.summary).toMatch(/life insurance shortfall/);
    expect(personaTensions(michael).find((x) => x.id === "T2")!.topics).toEqual(["advice.retirement"]);
  });

  it("matches a lost topic to the tension most specifically about it", () => {
    const b = advisorBrief(weah, [consent("melanie", true), react("melanie", "advice.debt", "lost")]);
    // T1 touches four topics; T3 is about the 18% card and the cash beside it.
    expect(b.agenda[0]!.personaPredicted?.id).toBe("T3");
  });
});
