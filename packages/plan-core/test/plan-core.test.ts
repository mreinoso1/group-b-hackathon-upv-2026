import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  at,
  buildCapsule,
  caseSummary,
  LEVELS,
  LocalCaseSource,
  milestones,
  nextTopic,
  personaProfile,
  splitBullets,
  TOPICS,
  UnknownCaseError,
  UnknownTopicError,
  type RawCase,
} from "../src/index.ts";

const CASES = fileURLToPath(new URL("../../../cases", import.meta.url));
const source = new LocalCaseSource(CASES);
const ids = await source.listIds();
const all: RawCase[] = await Promise.all(ids.map((id) => source.getCase(id)));

/** Resolves a figure source such as "financial-health:profile.liabilities[0].balance". */
function resolve(raw: RawCase, src: string): unknown {
  const [file, path] = src.split(":") as [string, string];
  return at(file === "financial-health" ? raw.financialHealth : raw.investmentAnalysis, path);
}

describe("cases", () => {
  it("finds the four families", () => {
    expect(ids).toEqual(["daniel-emily-johnson", "michael-carter", "samantha-lewis", "timothy-melanie-weah"]);
  });

  it("knows who the adults are", () => {
    const weah = caseSummary(all.find((c) => c.id === "timothy-melanie-weah")!);
    expect(weah.members.map((m) => m.id)).toEqual(["timothy", "melanie"]);
    expect(weah.members.map((m) => m.riskProfile)).toEqual(["Growth", "Moderate"]);
    expect(weah.children.map((c) => c.name)).toEqual(["Liam", "Josh"]);
    const carter = caseSummary(all.find((c) => c.id === "michael-carter")!);
    expect(carter.members).toHaveLength(1);
  });

  it("rejects unknown or unsafe case ids", async () => {
    await expect(source.getCase("nobody")).rejects.toBeInstanceOf(UnknownCaseError);
    await expect(source.getCase("../secrets")).rejects.toBeInstanceOf(UnknownCaseError);
  });

  it("labels distress events in the living map", () => {
    const carter = milestones(all.find((c) => c.id === "michael-carter")!);
    const event = carter.find((m) => m.distress);
    expect(event?.label).toBe("Savings projected to run out");
  });

  it("reads the persona classification block", () => {
    const p = personaProfile(all.find((c) => c.id === "timothy-melanie-weah")!);
    expect(p.classification.D4).toBe("MISALIGNED");
    expect(p.classification.D5).toBe("COLLABORATOR");
    expect(p.memberRisk).toEqual({ timothy: "Growth", melanie: "Moderate" });
  });
});

describe("splitBullets", () => {
  it("joins wrapped lines and keeps decimals", () => {
    expect(splitBullets("- One $5,250.10 a\n  year.\n- Two.")).toEqual(["One $5,250.10 a year.", "Two."]);
  });
  it("falls back to paragraphs", () => {
    expect(splitBullets("Just one paragraph.")).toEqual(["Just one paragraph."]);
  });
});

describe.each(all.map((raw) => [raw.id, raw] as const))("capsules for %s", (_id, raw) => {
  const json = JSON.stringify([raw.financialHealth, raw.investmentAnalysis]);

  it.each(TOPICS.map((t) => t.id))("%s builds at every level", (topicId) => {
    for (const level of LEVELS) {
      const c = buildCapsule(raw, { topicId, level });
      expect(c.blocks.length).toBeGreaterThan(0);
      expect(c.estSeconds).toBeGreaterThan(0);
    }
  });

  it.each(TOPICS.map((t) => t.id))("%s standard text is the plan's own words", (topicId) => {
    const c = buildCapsule(raw, { topicId, level: "standard" });
    expect(c.generatedBy).toBe("verbatim");
    for (const b of c.blocks) {
      // Every sentence fragment must exist in the plan JSON (bullets are only split and re-joined).
      const fragment = b.text.replace(/^\*\*[^*]+\*\*: /, "").slice(0, 60);
      expect(json).toContain(JSON.stringify(fragment).slice(1, -1));
    }
  });

  it.each(TOPICS.map((t) => t.id))("%s figures all come from the JSON", (topicId) => {
    const c = buildCapsule(raw, { topicId, level: "expert" });
    for (const f of c.figures) {
      const v = resolve(raw, f.source);
      if (f.unit === "%") expect(Math.round((v as number) * 10000) / 100).toBe(f.value);
      else if (f.value === 0) expect([0, false, undefined]).toContain(v);
      else expect(v).toBe(f.value);
    }
  });
});

describe("topics", () => {
  it("rejects unknown topics", () => {
    expect(() => buildCapsule(all[0]!, { topicId: "advice.crypto", level: "standard" })).toThrow(UnknownTopicError);
  });
  it("walks the default order and ends", () => {
    expect(nextTopic("overview.score")).toBe("overview.big_picture");
    expect(nextTopic(TOPICS[TOPICS.length - 1]!.id)).toBeNull();
  });
  it("keeps standard capsules short enough for 30–60 s", () => {
    for (const raw of all) {
      for (const t of TOPICS.filter((t) => !t.budget)) {
        expect(buildCapsule(raw, { topicId: t.id, level: "standard" }).estSeconds).toBeLessThanOrEqual(75);
      }
    }
  });
});
