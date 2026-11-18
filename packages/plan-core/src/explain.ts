// Builds the "I'm lost" re-explanation request. Pure: no network. The MCP prompt
// `explain_simple` and the get_capsule tool both use this, so they always say the same thing.
import { buildCapsule } from "./capsule.ts";
import { allowedNumbers, extractNumbers } from "./guard.ts";
import { children, members, personaProfile } from "./household.ts";
import type { RawCase } from "./load.ts";
import { firstSentence } from "./text.ts";
import { findTopic } from "./topics.ts";
import type { Block } from "./types.ts";

// Plain words first: most people who say "I'm lost" need the same idea said simply, not an image.
// The single number next, and an analogy only if both of those did not land.
export const EXPLAIN_STYLES = ["plain", "one_number", "analogy"] as const;
export type ExplainStyle = (typeof EXPLAIN_STYLES)[number];

/** An image that fits each idea, so analogies don't all sound the same. */
const ANALOGY_BY_TOPIC: Record<string, string> = {
  "overview.score": "a yearly health check-up",
  "overview.big_picture": "a map of where everything sits in a house",
  "map.timeline": "a road trip with planned stops",
  "advice.protection.life_insurance": "a seatbelt for the people who depend on you",
  "advice.protection.umbrella": "a roof that covers more than one room",
  "advice.debt": "a leaky bucket",
  "advice.protection.emergency_fund": "a spare tire",
  "advice.savings": "planting a garden",
  "advice.retirement": "a long hike and the water you carry",
  "advice.assets": "a backpack: what you carry and what you could use",
  "advice.investments": "a recipe and its ingredients",
  "advice.priorities": "one paycheck and several bills asking for it",
};

/** Each new "I'm lost" on the same idea tries a different way in. */
export function styleFor(attempt: number): ExplainStyle {
  return EXPLAIN_STYLES[Math.min(Math.max(0, attempt), EXPLAIN_STYLES.length - 1)]!;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ExplainPrompt {
  messages: ChatMessage[];
  /** Numbers the answer may use: exactly those written in the plan text it was given. */
  allowed: number[];
  /** The plan's own words, always shown beside the re-explanation. */
  planWords: Block[];
  style: ExplainStyle;
  /** Who it is written for, as shown to the model. */
  audience: string;
  /** People the answer may name (named in the plan text, or the reader) and everyone in the household. */
  people: { allowed: string[]; household: string[] };
}

const STYLE_GUIDE: Record<ExplainStyle, string> = {
  analogy: "Use one everyday analogy to make the idea click, then tie it back to the plan.",
  plain: "Say the same idea again in two or three short, plain sentences, the way you would tell a friend: the fact itself first (do not start with \"The plan\"), then what it means for them. Use everyday words a 12-year-old knows: swap the plan's jargon (\"cohesive strategy\", \"optimize\", \"liquidity\", \"allocation\") for simple words, and do not reuse the plan's sentences. No images or comparisons.",
  one_number: "Focus on the single most important figure in the text and say plainly why it matters to them. Two sentences at most.",
};

/**
 * Tone comes from the persona (advisor-only data) as a few adjectives: they shape the voice
 * without giving the model phrases it could repeat back to the family.
 */
export function toneFor(raw: RawCase, memberId: string | null): string[] {
  const persona = personaProfile(raw);
  const words: string[] = [];
  const risk = memberId ? persona.memberRisk[memberId] : undefined;
  if (risk && /growth|aggressive/i.test(risk)) words.push("confident", "forward-looking");
  else if (risk) words.push("reassuring", "steady");
  const style = persona.classification.D5 ?? "";
  if (/VALIDATOR/.test(style)) words.push("precise");
  const anchor = persona.classification.D6 ?? "";
  if (/PROTECTION/.test(anchor)) words.push("family-protective");
  if (/SECURITY|STABILITY/.test(anchor)) words.push("calm");
  if (/GROWTH|ASPIRATION/.test(anchor)) words.push("goal-minded");
  return words;
}

const SENTENCE = /(?<=[.!?])\s+(?=[A-Z])/;

/**
 * Groups the plan's sentences by who they are about, so the model cannot hand one partner's
 * figures to the other: "About you (Melanie)", "About Timothy", "About the household".
 */
function groupByPerson(texts: string[], reader: string | undefined, others: string[]): string[] {
  const sentences = texts.flatMap((t) => t.split(SENTENCE).map((s) => s.trim())).filter(Boolean);
  if (!reader) return sentences.map((s) => `- ${s}`);
  const mentions = (s: string, name: string) => new RegExp(`\\b${name}\\b`).test(s);
  const mine = sentences.filter((s) => mentions(s, reader) && !others.some((o) => mentions(s, o)));
  const theirs = others.map((o) => ({ name: o, list: sentences.filter((s) => mentions(s, o) && !mentions(s, reader)) }));
  const shared = sentences.filter((s) => !mine.includes(s) && !theirs.some((t) => t.list.includes(s)));
  const out: string[] = [];
  if (mine.length) out.push(`About you (${reader}):`, ...mine.map((s) => `- ${s}`));
  for (const t of theirs) if (t.list.length) out.push(`About ${t.name} (not the reader):`, ...t.list.map((s) => `- ${s}`));
  if (shared.length) out.push(others.length ? "About the household:" : "From the plan:", ...shared.map((s) => `- ${s}`));
  return out;
}

/**
 * A dollar amount a person can remember: $171,055.83 → 171000, $6,418.40 → 6418. Null when the
 * figure is already round, is not money, or is small enough to say exactly.
 */
export function roundedAmount(raw: string, value: number): number | null {
  if (!raw.startsWith("$") || /[kmb%]|thousand|million|billion/i.test(raw)) return null;
  const r = value >= 10_000 ? Math.round(value / 1000) * 1000 : Math.round(value);
  return r !== value && r > 0 ? r : null;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function buildExplainPrompt(raw: RawCase, topicId: string, memberId: string | null, attempt = 0): ExplainPrompt {
  const topic = findTopic(topicId);
  const standard = buildCapsule(raw, { topicId, level: "standard" });
  const style = styleFor(attempt);
  const ms = members(raw);
  const me = memberId && memberId !== "together" ? ms.find((m) => m.id === memberId) : undefined;
  const audience = me ? me.name : ms.map((m) => m.name).join(" and ");
  const others = me ? ms.filter((m) => m.id !== me.id).map((m) => m.name) : [];
  const texts = standard.blocks.map((b) => b.text);
  const allowed = allowedNumbers(texts);
  const mentions = texts.flatMap((t) => extractNumbers(t));
  const written = [...new Set(mentions.map((n) => n.raw))];
  // Big or exact amounts also get a rounded form the guard accepts ("about $171,000" for $171,055.83).
  const rounded = new Map<string, number>();
  for (const n of mentions) {
    const r = roundedAmount(n.raw, n.value);
    if (r !== null) rounded.set(n.raw, r);
  }
  for (const r of rounded.values()) if (!allowed.includes(r)) allowed.push(r);
  const tone = toneFor(raw, me?.id ?? null);
  const household = [...ms.map((m) => m.name), ...children(raw).map((c) => c.name)];

  const system = [
    `You re-explain ONE idea from a family's financial plan to ${audience}, who said "I'm lost". Write to them in the second person.`,
    "Rules:",
    "- Use only the plan text you are given. Add no advice, products, predictions, opinions or new facts.",
    "- Never say whose a debt, account or policy is unless the plan text says so.",
    "- Every number you write must be copied exactly from ALLOWED NUMBERS. Never round, convert or calculate yourself.",
    "- When a figure has a rounded form listed (\"≈ $171,000\"), use the rounded form and say \"about\": people remember round numbers.",
    "- Use at most TWO numbers in total, the ones that matter most to the reader.",
    ...(me && others.length
      ? [`- Lead with what is about ${me.name}. Sentences about ${others.join(" and ")} are theirs: name them, never say "you" about them.`]
      : ms.length === 1
        ? ["- They live alone in this plan: do not mention a partner."]
        : []),
    "- Do not tell them what to do first: the order of their priorities is their own decision.",
    "- Plain English, no jargon. One paragraph of 2 to 4 short sentences, under 70 words; say each thing once. No headings, lists, links or markdown.",
    "- Calm and encouraging, never alarming. If the plan text sounds harsh, keep its facts but say them calmly; add no urgency.",
    "- You are not their advisor: never write \"let me\", \"let's\" or \"we\", and never tell them to seek help.",
    "- Leave out the plan's judgments about their well-being, stress or life; keep to what the plan measures and what it means for them.",
    `- ${STYLE_GUIDE[style]}${style === "analogy" ? ` A good image for this idea: ${ANALOGY_BY_TOPIC[topicId] ?? "something from everyday life"}. Avoid comparing it to a household budget.` : ""}`,
    ...(tone.length ? [`Voice: ${tone.join(", ")}.`] : []),
  ].join("\n");

  const user = [
    `PLAN TEXT (${topic?.title ?? topicId}):`,
    ...groupByPerson(texts, me?.name, others),
    "",
    `ALLOWED NUMBERS: ${written.length ? written.map((w) => (rounded.has(w) ? `${w} (≈ ${money(rounded.get(w)!)})` : w)).join(" · ") : "none: write without numbers"}`,
  ].join("\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    allowed,
    planWords: standard.blocks,
    style,
    audience,
    people: {
      allowed: household.filter((n) => (me && n === me.name) || texts.some((t) => new RegExp(`\\b${n}\\b`).test(t))),
      household,
    },
  };
}

/**
 * The fallback when no model is available or its answer fails the guard: one sentence of the
 * plan, preferring the one about the person reading.
 */
export function fallbackSimple(planWords: Block[], memberName?: string): Block[] {
  const sentences = planWords.flatMap((b) => b.text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((text) => ({ text: text.trim(), source: b.source })));
  const mine = memberName ? sentences.find((s) => new RegExp(`\\b${memberName}\\b`).test(s.text)) : undefined;
  const pick = mine ?? sentences[0];
  return pick ? [{ text: firstSentence(pick.text), source: pick.source }] : [];
}
