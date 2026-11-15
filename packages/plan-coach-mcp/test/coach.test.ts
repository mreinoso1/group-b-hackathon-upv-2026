import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildCapsule, LocalCaseSource } from "@bite/plan-core";
import type { AiClient } from "../src/ai.ts";
import { FileBudget } from "../src/budget.ts";
import { MemoryCache } from "../src/cache.ts";
import { capsuleAudio, simpleCapsule, spokenText } from "../src/coach.ts";
import { maxSpeechBytes, plausibleLength, saidTheText, wav } from "../src/voice.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const weah = await source.getCase("timothy-melanie-weah");
const TOPIC = "advice.protection.life_insurance";

function fakeAi(answers: string[]) {
  const ai = {
    calls: 0,
    chat: vi.fn(async () => {
      const text = answers[Math.min(ai.calls, answers.length - 1)]!;
      ai.calls++;
      return { text, promptTokens: 1500, completionTokens: 800 };
    }),
    speech: vi.fn(async () => new Uint8Array([1, 2, 3])),
    voice: vi.fn(async (text: string) => ({ pcm: new Uint8Array([0, 0, 1, 0]), transcript: text, usd: 0.002 })),
  };
  return ai;
}

const deps = (ai?: AiClient, caps = { text: 1, tts: 1, voice: 1 }) => ({ ai, cache: new MemoryCache(), budget: new FileBudget(null, caps) });

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
    expect((await simpleCapsule(weah, TOPIC, "melanie", 0, deps(broke, { text: 0, tts: 0, voice: 0 }))).generatedBy).toBe("fallback");
    expect(broke.calls).toBe(0);
    const failing: AiClient = {
      chat: async () => Promise.reject(new Error("429")),
      speech: async () => new Uint8Array(),
      voice: async () => Promise.reject(new Error("429")),
    };
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
    expect(await capsuleAudio(capsule, deps(ai, { text: 1, tts: 0.0001, voice: 0.0001 }))).toMatchObject({ kind: "browser", reason: "budget" });
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

describe("English voice when ElevenLabs is down", () => {
  const capsule = buildCapsule(weah, { topicId: "advice.debt", level: "standard" });

  it("reads it with the realtime voice model and caches a WAV", async () => {
    const ai = fakeAi([""]);
    ai.speech.mockRejectedValue(new Error("AI proxy /v1/audio/speech answered 500: upstream"));
    const d = deps(ai);
    const first = await capsuleAudio(capsule, d);
    expect(first).toMatchObject({ kind: "audio", format: "wav", cached: false });
    expect(await capsuleAudio(capsule, d)).toMatchObject({ kind: "audio", format: "wav", cached: true });
    expect(ai.voice).toHaveBeenCalledTimes(1);
  });

  it("throws the audio away when the voice did not say the text", async () => {
    const ai = fakeAi([""]);
    ai.speech.mockRejectedValue(new Error("AI proxy /v1/audio/speech answered 500: upstream"));
    ai.voice.mockResolvedValue({ pcm: new Uint8Array([0, 0]), transcript: "Your debt is about ninety thousand dollars, roughly $90,000.", usd: 0.002 });
    expect(await capsuleAudio(capsule, deps(ai))).toMatchObject({ kind: "browser", reason: "error" });
    expect(ai.voice).toHaveBeenCalledTimes(2);
  });
});

describe("saidTheText", () => {
  const text = "Your debts. The one costly exception is the $18,000 Chase card at 18%.";
  it("accepts a faithful reading, however the transcript spells it", () => {
    expect(saidTheText(text, "Your debts. The one costly exception is the $18,000 Chase card at 18%.")).toBe(true);
    expect(saidTheText(text, "your debts the one costly exception is the $18,000 chase card at 18%")).toBe(true);
  });
  it("rejects changed numbers, missing words or extra commentary", () => {
    expect(saidTheText(text, "Your debts. The one costly exception is the $19,000 Chase card at 18%.")).toBe(false);
    expect(saidTheText(text, "Your debts.")).toBe(false);
    expect(saidTheText(text, `${text} Great question! Let me also tell you about your mortgage and your savings and your plan.`)).toBe(false);
  });
});

describe("wav", () => {
  it("wraps PCM in a valid 24 kHz mono header", () => {
    const out = wav(new Uint8Array(480));
    const view = new DataView(out.buffer);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(480);
    expect(out.length).toBe(524);
  });
  it("spoken text drops markdown", () => {
    expect(spokenText({ ...buildCapsule(weah, { topicId: "advice.debt", level: "standard" }), blocks: [{ text: "**Bold** words", source: "x" }] })).toBe("Your debts. Bold words");
  });
});

describe("voice models without a transcript (Gemini)", () => {
  const text = "Hey Melanie. It's you, at 60, the year we retire. Here's what got us here, and the one thing to do this week.";
  const pcmFor = (seconds: number) => Math.round(seconds * 24000 * 2);

  it("accepts audio whose length fits the text", () => {
    expect(plausibleLength(text, pcmFor(8.7))).toBe(true);
  });
  it("rejects audio far too long or too short for the text", () => {
    expect(plausibleLength(text, pcmFor(30))).toBe(false);
    expect(plausibleLength(text, pcmFor(3))).toBe(false);
  });
  it("caches it when the length fits", async () => {
    const ai = fakeAi([""]);
    ai.speech.mockRejectedValue(new Error("AI proxy /v1/audio/speech answered 500: upstream"));
    ai.voice.mockResolvedValue({ pcm: new Uint8Array(pcmFor(8.7)), transcript: "", usd: 0.005 });
    const capsule = { ...buildCapsule(weah, { topicId: "advice.debt", level: "standard" }), title: "Hey Melanie", blocks: [{ text: text.slice(13), source: "x" }] };
    expect(await capsuleAudio(capsule, deps(ai))).toMatchObject({ kind: "audio", format: "wav" });
  });
});

describe("streamed voice", () => {
  const capsule = buildCapsule(weah, { topicId: "advice.protection.umbrella", level: "standard" });
  const seconds = (s: number) => Math.round(s * 24000 * 2);

  it("answers at once, writes the audio as it comes, then keeps the WAV", async () => {
    const ai = fakeAi([""]);
    ai.speech.mockRejectedValue(new Error("AI proxy /v1/audio/speech answered 500: upstream"));
    const total = seconds(spokenText(capsule).split(/\s+/).length / 2.5);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ai.voice.mockImplementation(async (_text: string, onChunk?: (pcm: Uint8Array) => void) => {
      onChunk?.(new Uint8Array(total / 2));
      await gate; // still generating
      onChunk?.(new Uint8Array(total / 2));
      return { pcm: new Uint8Array(total), transcript: "", usd: 0.01 };
    });
    const d = deps(ai);
    const r = await capsuleAudio(capsule, d, { stream: true });
    expect(r.kind).toBe("stream");
    const id = (r as { audioId: string }).audioId;
    await Promise.resolve();
    expect(d.cache.getBytes("audio", id, "part")?.length).toBe(total / 2);
    release();
    await vi.waitFor(() => expect(d.cache.has("audio", id, "wav")).toBe(true));
    expect(await capsuleAudio(capsule, d, { stream: true })).toMatchObject({ kind: "audio", cached: true });
  });

  it("removes the partial audio when the voice fails", async () => {
    const ai = fakeAi([""]);
    ai.speech.mockRejectedValue(new Error("AI proxy /v1/audio/speech answered 500: upstream"));
    ai.voice.mockImplementation(async (_t: string, onChunk?: (pcm: Uint8Array) => void) => {
      onChunk?.(new Uint8Array(100));
      throw new Error("voice ran far longer than the text");
    });
    const d = deps(ai);
    const r = await capsuleAudio(capsule, d, { stream: true });
    const id = (r as { audioId: string }).audioId;
    await vi.waitFor(() => expect(d.cache.has("audio", id, "part")).toBe(false));
    expect(d.cache.has("audio", id, "wav")).toBe(false);
  });
});

describe("maxSpeechBytes", () => {
  it("allows a slow reading of the text, not a long ramble", () => {
    const text = "Hey Melanie. It's you, at 60, the year we retire. Here's what got us here, and the one thing to do this week.";
    expect(maxSpeechBytes(text)).toBeGreaterThan(Math.round(8.7 * 48000));
    expect(maxSpeechBytes(text)).toBeLessThan(30 * 48000);
  });
});
