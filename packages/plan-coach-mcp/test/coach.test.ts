import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildCapsule, LocalCaseSource } from "@bite/plan-core";
import type { AiClient } from "../src/ai.ts";
import { FileBudget } from "../src/budget.ts";
import { MemoryCache } from "../src/cache.ts";
import { capsuleAudio, simpleCapsule } from "../src/coach.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const weah = await source.getCase("timothy-melanie-weah");
const TOPIC = "advice.protection.life_insurance";

function fakeAi(answers: string[]): AiClient & { calls: number } {
  const ai = {
    calls: 0,
    chat: vi.fn(async () => {
      const text = answers[Math.min(ai.calls, answers.length - 1)]!;
      ai.calls++;
      return { text, promptTokens: 1500, completionTokens: 800 };
    }),
    speech: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  return ai;
}

const deps = (ai?: AiClient, caps = { text: 1, tts: 1 }) => ({ ai, cache: new MemoryCache(), budget: new FileBudget(null, caps) });

describe("simpleCapsule", () => {
  it("uses a checked re-explanation and keeps the plan's words beside it", async () => {
    const ai = fakeAi(["Think of it like an umbrella: you hold $110,000 of cover where the plan suggests $600,000."]);
    const d = deps(ai);
    const c = await simpleCapsule(weah, TOPIC, "melanie", 0, d);
    expect(c.generatedBy).toBe("llm");
    expect(c.style).toBe("analogy");
    expect(c.check?.numbersChecked).toBe(2);
    expect(c.planWords.length).toBeGreaterThan(0);
    expect(d.budget.report().text.spent).toBeGreaterThan(0);
  });

  it("serves a repeat from the cache without calling the model", async () => {
    const ai = fakeAi(["You hold $110,000 of cover; the plan suggests $600,000."]);
    const d = deps(ai);
    await simpleCapsule(weah, TOPIC, "melanie", 0, d);
    const again = await simpleCapsule(weah, TOPIC, "melanie", 0, d);
    expect(ai.calls).toBe(1);
    expect(again.generatedBy).toBe("llm");
  });

  it("asks once more when a number is invented, then accepts a clean answer", async () => {
    const ai = fakeAi(["You have about $100,000.", "You hold $110,000; the plan suggests $600,000."]);
    const c = await simpleCapsule(weah, TOPIC, "melanie", 0, deps(ai));
    expect(ai.calls).toBe(2);
    expect(c.generatedBy).toBe("llm");
    expect(c.blocks[0]!.text).not.toContain("$100,000");
  });

  it("asks for a shorter answer once when it is too busy, then accepts a correct one", async () => {
    const busy = "Timothy has $140,000, Melanie $110,000 against $600,000, a $490,000 gap.";
    const ai = fakeAi([busy, busy]);
    const c = await simpleCapsule(weah, TOPIC, "melanie", 0, deps(ai));
    expect(ai.calls).toBe(2);
    expect(c.generatedBy).toBe("llm");
  });

  it("falls back to the plan when the model keeps inventing numbers", async () => {
    const ai = fakeAi(["You have about $100,000.", "Roughly $99,000 short."]);
    const c = await simpleCapsule(weah, TOPIC, "melanie", 0, deps(ai));
    expect(c.generatedBy).toBe("fallback");
    expect(c.blocks[0]!.text).toMatch(/^Melanie/);
  });

  it("falls back without a key or without budget, and never throws on errors", async () => {
    expect((await simpleCapsule(weah, TOPIC, "melanie", 0, deps())).generatedBy).toBe("fallback");
    const broke = fakeAi(["You hold $110,000."]);
    expect((await simpleCapsule(weah, TOPIC, "melanie", 0, deps(broke, { text: 0, tts: 0 }))).generatedBy).toBe("fallback");
    expect(broke.calls).toBe(0);
    const failing: AiClient = { chat: async () => Promise.reject(new Error("429")), speech: async () => new Uint8Array() };
    expect((await simpleCapsule(weah, TOPIC, "melanie", 0, deps(failing))).generatedBy).toBe("fallback");
  });
});

describe("capsuleAudio", () => {
  const capsule = buildCapsule(weah, { topicId: TOPIC, level: "standard" });

  it("generates once, then serves from the cache", async () => {
    const ai = fakeAi([""]);
    const d = deps(ai);
    const first = await capsuleAudio(capsule, d);
    const second = await capsuleAudio(capsule, d);
    expect(first).toMatchObject({ kind: "audio", cached: false });
    expect(second).toMatchObject({ kind: "audio", cached: true });
    expect(ai.speech).toHaveBeenCalledTimes(1);
    expect(d.budget.report().tts.spent).toBeGreaterThan(0);
  });

  it("hands the text to the browser's voice without a key or over budget", async () => {
    expect(await capsuleAudio(capsule, deps())).toMatchObject({ kind: "browser", reason: "no_key" });
    const ai = fakeAi([""]);
    expect(await capsuleAudio(capsule, deps(ai, { text: 1, tts: 0.0001 }))).toMatchObject({ kind: "browser", reason: "budget" });
    expect(ai.speech).not.toHaveBeenCalled();
  });
});

describe("people guard", () => {
  it("asks again when the model names someone the plan text does not", async () => {
    const ai = fakeAi(["Melanie holds the mortgage; your card is $18,000 at 18%.", "Timothy, your card is $18,000 at 18%."]);
    const c = await simpleCapsule(weah, "advice.debt", "timothy", 0, deps(ai));
    expect(ai.calls).toBe(2);
    expect(c.generatedBy).toBe("llm");
    expect(c.blocks[0]!.text).not.toContain("Melanie");
  });
});

describe("in-flight requests", () => {
  it("a prefetch and a tap for the same explanation share one model call", async () => {
    const ai = fakeAi(["Melanie, you hold $110,000 where the plan suggests $600,000."]);
    const d = deps(ai);
    const [a, b] = await Promise.all([simpleCapsule(weah, TOPIC, "melanie", 0, d), simpleCapsule(weah, TOPIC, "melanie", 0, d)]);
    expect(ai.calls).toBe(1);
    expect(a.blocks[0]!.text).toBe(b.blocks[0]!.text);
  });
});
