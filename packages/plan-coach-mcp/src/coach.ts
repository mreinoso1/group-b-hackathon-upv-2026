// The calibration logic behind "I'm lost" and the play button. Model output is cached,
// sanitised and number-checked; anything that fails falls back to the plan's own words.
import {
  buildCapsule,
  buildExplainPrompt,
  checkNumbers,
  checkPeople,
  checkTone,
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
import { plausibleLength, saidTheText, wav } from "./voice.ts";

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
const CACHE_VERSION = 7;
const MAX_NUMBERS = 3; // "at most two" asked; a range like "$750,000 to $1,500,000" may need three
const MAX_WORDS = 90;

interface CachedExplain {
  text: string;
  numbersChecked: number;
  style: string;
}

/** Requests for the same explanation that are already running (a prefetch, then a tap). */
const inflight = new Map<string, Promise<CachedExplain | null>>();

/** Where an "I'm lost" explanation is cached: changes whenever the prompt, model or version changes. */
export function explainKey(prompt: { messages: ChatMessage[] }, deps: Pick<CoachDeps, "textModel">): string {
  return cacheKey({ v: CACHE_VERSION, model: deps.textModel ?? "gpt-5-mini", reasoning: process.env.TEXT_REASONING ?? "low", messages: prompt.messages });
}

/** A simple capsule: a checked re-explanation when possible, otherwise the plan-based fallback. */
export async function simpleCapsule(raw: RawCase, topicId: string, member: string | null, attempt: number, deps: CoachDeps): Promise<Capsule> {
  const base = buildCapsule(raw, { topicId, level: "simple", member });
  const prompt = buildExplainPrompt(raw, topicId, member, attempt);
  const withStyle = { ...base, style: prompt.style };
  const key = explainKey(prompt, deps);

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

/** Asks the model, checks numbers, people, tone and length; one corrective retry. Null means fall back. */
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
      const tone = checkTone(text);
      // Sometimes the model returns two drafts of the same answer, one per paragraph.
      const oneAnswer = !text.includes("\n");
      // Safety (numbers and people from the plan), tone and a single answer are always required.
      // Brevity is asked for once more, then accepted: a slightly long but correct answer beats the fallback.
      const tooBusy = guard.checked > MAX_NUMBERS || wordCount(text) > MAX_WORDS;
      if (text && guard.ok && people.ok && tone.ok && oneAnswer && (!tooBusy || round > 0)) {
        return { text, numbersChecked: guard.checked, style: prompt.style };
      }
      const problem = !guard.ok
        ? `These numbers are not in the plan text: ${guard.unknown.join(", ")}. Rewrite it using only ALLOWED NUMBERS, or no numbers at all.`
        : !people.ok
          ? `The plan text does not mention ${people.unknown.join(" or ")} here. Rewrite it without naming them.`
          : !tone.ok
            ? `Rewrite it without ${tone.problems.join(" or ")}: calm, plain, and only what the plan measures.`
            : !text
              ? "The answer was empty. Write the explanation."
              : !oneAnswer
                ? "Give one answer only: a single paragraph that says each thing once."
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
  | { kind: "audio"; audioId: string; format: "mp3" | "wav"; cached: boolean; chars: number }
  /** Being generated now: its PCM grows in the cache as `<audioId>.part` until the WAV is written. */
  | { kind: "stream"; audioId: string }
  | { kind: "browser"; text: string; reason: "no_key" | "budget" | "error" | "unavailable" };

/** After ElevenLabs refuses us (e.g. 401 upstream), stop asking it for a while. */
let elevenPausedUntil = 0;
const PAUSE_MS = 10 * 60_000;
const VOICE_ESTIMATE_USD = 0.03; // a long capsule read by a voice model: about 2 cents

/** What would be read aloud for a capsule: its title and its words, without markdown. */
export function spokenText(c: Capsule): string {
  return [c.title, ...c.blocks.map((b) => b.text)].join(". ").replace(/\*\*/g, "").replace(/\.\./g, ".");
}

/** Audio for a capsule, generated on first request and cached. */
export async function capsuleAudio(capsule: Capsule, deps: CoachDeps, opts: { stream?: boolean } = {}): Promise<AudioResult> {
  return speak(spokenText(capsule), deps, opts);
}

/**
 * Speech for any plan-derived text (a capsule, the future self's opening line), in English:
 * ElevenLabs when it works, otherwise a realtime voice model whose transcript must match the
 * text. One cached clip per text. Only when neither is possible does the caller fall back to
 * the device's voice.
 */
export async function speak(text: string, deps: CoachDeps, opts: { stream?: boolean } = {}): Promise<AudioResult> {
  const audioId = cacheKey({ v: CACHE_VERSION, kind: "speech", text });
  for (const format of ["mp3", "wav"] as const) {
    if (deps.cache.has("audio", audioId, format)) return { kind: "audio", audioId, format, cached: true, chars: text.length };
  }
  if (!deps.ai) return { kind: "browser", text, reason: "no_key" };
  // ElevenLabs returns a whole mp3 in a second or two: wait for it even when streaming. The stream
  // only carries the voice model's live audio, so answering "stream" and then making an mp3 left
  // the player waiting for audio that never came (silence until a second tap found the mp3).
  // A prefetch and a tap for the same text share one generation.
  const mp3 = await shared(elevenJobs, audioId, () => viaEleven(text, audioId, deps));
  if (mp3) return mp3;
  if (opts.stream) {
    if (!voiceJobs.has(audioId) && !deps.budget.canSpend("voice", VOICE_ESTIMATE_USD)) return { kind: "browser", text, reason: "budget" };
    // Answer at once; the client plays the voice model's audio as it is written.
    void shared(voiceJobs, audioId, () => viaVoice(text, audioId, deps));
    return { kind: "stream", audioId };
  }
  return shared(voiceJobs, audioId, () => viaVoice(text, audioId, deps));
}

const elevenJobs = new Map<string, Promise<AudioResult | null>>();
const voiceJobs = new Map<string, Promise<AudioResult>>();

/** One job per text at a time: a second request for the same text waits for the first. */
function shared<T>(jobs: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  let job = jobs.get(key);
  if (!job) {
    job = start();
    jobs.set(key, job);
    void job.finally(() => jobs.delete(key));
  }
  return job;
}

/** ElevenLabs' mp3, cached; null when it is paused, over budget or fails. */
async function viaEleven(text: string, audioId: string, deps: CoachDeps): Promise<AudioResult | null> {
  if (!deps.ai || Date.now() < elevenPausedUntil) return null;
  const estimate = text.length * PRICES["eleven-flash-v2.5"].perChar;
  if (!deps.budget.canSpend("tts", estimate)) return null;
  try {
    const bytes = await deps.ai.speech(text);
    deps.budget.record("tts", estimate);
    deps.cache.putBytes("audio", audioId, "mp3", bytes);
    return { kind: "audio", audioId, format: "mp3", cached: false, chars: text.length };
  } catch (e) {
    const message = (e as Error).message;
    deps.log?.(`elevenlabs failed: ${message.slice(0, 120)}`);
    if (/ 40[13]/.test(message)) elevenPausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}

/** A realtime voice model reads the text, written to `<audioId>.part` as it comes, then kept as a WAV. */
async function viaVoice(text: string, audioId: string, deps: CoachDeps): Promise<AudioResult> {
  if (!deps.ai) return { kind: "browser", text, reason: "no_key" };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!deps.budget.canSpend("voice", VOICE_ESTIMATE_USD)) return { kind: "browser", text, reason: "budget" };
    deps.cache.remove("audio", audioId, "part");
    try {
      const r = await deps.ai.voice(text, (pcm) => deps.cache.appendBytes("audio", audioId, "part", pcm));
      deps.budget.record("voice", r.usd);
      // With a transcript, words and numbers must match; without one (Gemini), the length must fit.
      const faithful = r.transcript ? saidTheText(text, r.transcript) : plausibleLength(text, r.pcm.length);
      if (r.pcm.length && faithful) {
        deps.cache.putBytes("audio", audioId, "wav", wav(r.pcm));
        // Listeners still reading the partial file finish from the WAV; drop the part a bit later.
        setTimeout(() => deps.cache.remove("audio", audioId, "part"), 30_000).unref?.();
        return { kind: "audio", audioId, format: "wav", cached: false, chars: text.length };
      }
      deps.cache.remove("audio", audioId, "part");
      deps.log?.(`voice model strayed from the text: "${r.transcript.slice(0, 80)}"`);
    } catch (e) {
      deps.cache.remove("audio", audioId, "part");
      deps.log?.(`voice model failed: ${(e as Error).message.slice(0, 120)}`);
      return { kind: "browser", text, reason: "error" };
    }
  }
  return { kind: "browser", text, reason: "error" };
}

export function capsuleFor(raw: RawCase, topicId: string, level: Level, member: string | null): Capsule {
  return buildCapsule(raw, { topicId, level, member });
}
