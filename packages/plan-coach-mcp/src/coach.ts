// The calibration logic behind "I'm lost" and the play button. Model output is cached,
// sanitised and number-checked; anything that fails falls back to the plan's own words.
import {
  buildCapsule,
  buildExplainPrompt,
  checkNumbers,
  checkPeople,
  readSeconds,
  sanitizeModelText,
  wordCount,
  type Capsule,
  type ChatMessage,
  type Level,
  type RawCase,
} from "@bite/plan-core";
import { PRICES, type AiClient } from "./ai.ts";
import type { Budget } from "./budget.ts";
import { cacheKey, type Cache } from "./cache.ts";

export interface CoachDeps {
  ai?: AiClient;
  cache: Cache;
  budget: Budget;
  textModel?: string;
  ttsModel?: string;
  voice?: string;
  log?: (msg: string) => void;
}

const TEXT_ESTIMATE_USD = 0.005; // generous per-call estimate for the budget check
const CACHE_VERSION = 4;
const MAX_NUMBERS = 3; // "at most two" asked; a range like "$750,000 to $1,500,000" may need three
const MAX_WORDS = 90;

interface CachedExplain {
  text: string;
  numbersChecked: number;
  style: string;
}

/** Requests for the same explanation that are already running (a prefetch, then a tap). */
const inflight = new Map<string, Promise<CachedExplain | null>>();

/** A simple capsule: a checked re-explanation when possible, otherwise the plan-based fallback. */
export async function simpleCapsule(raw: RawCase, topicId: string, member: string | null, attempt: number, deps: CoachDeps): Promise<Capsule> {
  const base = buildCapsule(raw, { topicId, level: "simple", member });
  const prompt = buildExplainPrompt(raw, topicId, member, attempt);
  const withStyle = { ...base, style: prompt.style };
  const model = deps.textModel ?? "gpt-5-mini";
  const key = cacheKey({ v: CACHE_VERSION, model, reasoning: process.env.TEXT_REASONING ?? "low", messages: prompt.messages });

  const hit = deps.cache.getJson<CachedExplain>("explain", key);
  if (hit) return asModelCapsule(withStyle, hit);
  if (!deps.ai) return withStyle;

  let job = inflight.get(key);
  if (!job) {
    if (!deps.budget.canSpend("text", TEXT_ESTIMATE_USD)) {
      deps.log?.("text budget reached: using the plan's own words");
      return withStyle;
    }
    job = generateExplain(prompt, topicId, deps).then((value) => {
      if (value) deps.cache.putJson("explain", key, value);
      return value;
    });
    inflight.set(key, job);
    void job.finally(() => inflight.delete(key));
  }
  const value = await job;
  return value ? asModelCapsule(withStyle, value) : withStyle;
}

/** Asks the model, checks numbers, people and length; one corrective retry. Null means fall back. */
async function generateExplain(prompt: ReturnType<typeof buildExplainPrompt>, topicId: string, deps: CoachDeps): Promise<CachedExplain | null> {
  const ai = deps.ai!;
  const messages: ChatMessage[] = [...prompt.messages];
  for (let round = 0; round < 2; round++) {
    try {
      const res = await ai.chat(messages);
      deps.budget.record("text", res.promptTokens * PRICES["gpt-5-mini"].input + res.completionTokens * PRICES["gpt-5-mini"].output);
      const text = sanitizeModelText(res.text);
      const guard = checkNumbers(text, prompt.allowed);
      const people = checkPeople(text, prompt.people.allowed, prompt.people.household);
      // Safety (numbers and people from the plan) is always required. Brevity is asked for once
      // more, then accepted: a slightly long but correct answer beats the fallback.
      const tooBusy = guard.checked > MAX_NUMBERS || wordCount(text) > MAX_WORDS;
      if (text && guard.ok && people.ok && (!tooBusy || round > 0)) {
        return { text, numbersChecked: guard.checked, style: prompt.style };
      }
      const problem = !guard.ok
        ? `These numbers are not in the plan text: ${guard.unknown.join(", ")}. Rewrite it using only ALLOWED NUMBERS, or no numbers at all.`
        : !people.ok
          ? `The plan text does not mention ${people.unknown.join(" or ")} here. Rewrite it without naming them.`
          : !text
            ? "The answer was empty. Write the explanation."
            : `Too much at once (${guard.checked} numbers, ${wordCount(text)} words). Rewrite it with at most two numbers and under 70 words.`;
      deps.log?.(`retrying ${topicId}: ${problem.split(".")[0]}`);
      messages.push({ role: "assistant", content: res.text }, { role: "user", content: problem });
    } catch (e) {
      deps.log?.(`explain failed for ${topicId}: ${(e as Error).message}`);
      return null;
    }
  }
  return null;
}

function asModelCapsule(base: Capsule, value: CachedExplain): Capsule {
  const blocks = [{ text: value.text, source: `explain:${value.style}` }];
  return { ...base, blocks, generatedBy: "llm", style: value.style, check: { numbersChecked: value.numbersChecked }, estSeconds: readSeconds([value.text]) };
}

export type AudioResult =
  | { kind: "audio"; audioId: string; cached: boolean; chars: number }
  | { kind: "browser"; text: string; reason: "no_key" | "budget" | "error" | "unavailable" };

/** After the voice service refuses us (e.g. 401 upstream), stop asking for a while. */
let ttsPausedUntil = 0;
const TTS_PAUSE_MS = 10 * 60_000;

/** What would be read aloud for a capsule: its title and its words, without markdown. */
export function spokenText(c: Capsule): string {
  return [c.title, ...c.blocks.map((b) => b.text)].join(". ").replace(/\*\*/g, "").replace(/\.\./g, ".");
}

/**
 * Audio for a capsule, generated on first request and cached. When there is no key or the TTS
 * budget would be exceeded, the caller gets the text for the browser's own voice instead.
 */
export async function capsuleAudio(capsule: Capsule, deps: CoachDeps): Promise<AudioResult> {
  return speak(spokenText(capsule), deps);
}

/** Speech for any plan-derived text (a capsule, the future self's opening line). */
export async function speak(text: string, deps: CoachDeps): Promise<AudioResult> {
  const model = deps.ttsModel ?? "eleven-flash-v2.5";
  const voice = deps.voice ?? "alloy";
  const audioId = cacheKey({ v: CACHE_VERSION, model, voice, text });
  if (deps.cache.has("audio", audioId, "mp3")) return { kind: "audio", audioId, cached: true, chars: text.length };
  if (!deps.ai) return { kind: "browser", text, reason: "no_key" };
  if (Date.now() < ttsPausedUntil) return { kind: "browser", text, reason: "unavailable" };
  const estimate = text.length * PRICES["eleven-flash-v2.5"].perChar;
  if (!deps.budget.canSpend("tts", estimate)) return { kind: "browser", text, reason: "budget" };
  try {
    const bytes = await deps.ai.speech(text);
    deps.budget.record("tts", estimate);
    deps.cache.putBytes("audio", audioId, "mp3", bytes);
    return { kind: "audio", audioId, cached: false, chars: text.length };
  } catch (e) {
    const message = (e as Error).message;
    deps.log?.(`tts failed: ${message.slice(0, 120)}`);
    if (/ 40[13]/.test(message)) {
      ttsPausedUntil = Date.now() + TTS_PAUSE_MS;
      deps.log?.("voice service refused the request: using the browser's voice for 10 minutes");
    }
    return { kind: "browser", text, reason: "error" };
  }
}

export function capsuleFor(raw: RawCase, topicId: string, level: Level, member: string | null): Capsule {
  return buildCapsule(raw, { topicId, level, member });
}
