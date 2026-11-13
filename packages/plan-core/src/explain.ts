// Builds the "I'm lost" re-explanation request. Pure: no network. The MCP prompt
// `explain_simple` and the get_capsule tool both use this, so they always say the same thing.
import { buildCapsule } from "./capsule.ts";
import { allowedNumbers, extractNumbers } from "./guard.ts";
import { children, members, personaProfile } from "./household.ts";
import type { RawCase } from "./load.ts";
import { firstSentence } from "./text.ts";
import { findTopic } from "./topics.ts";
import type { Block } from "./types.ts";

export const EXPLAIN_STYLES = ["analogy", "steps", "one_number"] as const;
export type ExplainStyle = (typeof EXPLAIN_STYLES)[number];

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
  analogy: "Use one everyday analogy (a household budget, a car, an umbrella, groceries) to make the idea click, then tie it back to the plan.",
  steps: "Explain it as two or three very short plain sentences, in order: what you have now, what the plan says would be enough, what the difference means.",
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
  const written = [...new Set(texts.flatMap((t) => extractNumbers(t).map((n) => n.raw)))];
  const tone = toneFor(raw, me?.id ?? null);
  const household = [...ms.map((m) => m.name), ...children(raw).map((c) => c.name)];

  const system = [
    `You re-explain ONE idea from a family's financial plan to ${audience}, who said "I'm lost". Write to them in the second person.`,
    "Rules:",
    "- Use only the plan text you are given. Add no advice, products, predictions, opinions or new facts.",
    "- Never say whose a debt, account or policy is unless the plan text says so.",
    "- Every number you write must be copied exactly from ALLOWED NUMBERS. Never round, convert or calculate.",
    "- Use at most TWO numbers in total, the ones that matter most to the reader.",
    ...(me && others.length
      ? [`- Lead with what is about ${me.name}. Sentences about ${others.join(" and ")} are theirs: name them, never say "you" about them.`]
      : ms.length === 1
        ? ["- They live alone in this plan: do not mention a partner."]
        : []),
    "- Do not tell them what to do first: the order of their priorities is their own decision.",
    "- Plain English, no jargon. 2 to 4 short sentences, under 70 words. No headings, lists, links or markdown.",
    "- Calm and encouraging, never alarming.",
    `Way in: ${STYLE_GUIDE[style]}`,
    ...(tone.length ? [`Voice: ${tone.join(", ")}.`] : []),
  ].join("\n");

  const user = [
    `PLAN TEXT (${topic?.title ?? topicId}):`,
    ...groupByPerson(texts, me?.name, others),
    "",
    `ALLOWED NUMBERS: ${written.length ? written.join(" · ") : "none: write without numbers"}`,
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
