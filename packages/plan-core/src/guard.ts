// The number guard: a model's re-explanation may only use numbers that are in the plan
// section it was given. Anything else is rejected before it reaches a person.

export interface NumberMention {
  raw: string;
  value: number;
}

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};

// $1,234.56 · 18% · 1.25M · $750k · 2030 · 16 · 0.5 — with an optional scale word.
const NUMBER = /(?<![\w.])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|m|mn|b|thousand|million|billion)?%?(?![\w])/gi;

/** Every number written in digits in a text, normalised ($750k → 750000, 1.25M → 1250000). */
export function extractNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const base = Number(`${m[1]!.replace(/,/g, "")}${m[2] ?? ""}`);
    const scale = m[3] ? SCALE[m[3].toLowerCase()] ?? 1 : 1;
    if (Number.isFinite(base)) out.push({ raw: m[0].trim(), value: round(base * scale) });
  }
  return out;
}

/** Numbers small enough to be structure, not figures ("2 things", "step 1"). */
const STRUCTURAL = new Set([0, 1, 2, 3]);

export interface GuardResult {
  ok: boolean;
  checked: number;
  /** Numbers the model wrote that are not in the plan section. */
  unknown: string[];
}

/** Accepts the text only if every number in it appears in the allowed set. */
export function checkNumbers(text: string, allowed: Iterable<number>): GuardResult {
  const ok = new Set<number>();
  for (const n of allowed) ok.add(round(n));
  const mentions = extractNumbers(text);
  const unknown = mentions.filter((m) => !ok.has(m.value) && !STRUCTURAL.has(m.value)).map((m) => m.raw);
  return { ok: unknown.length === 0, checked: mentions.length, unknown };
}

/** The allowed set: every number written in the source texts, plus the structured figures. */
export function allowedNumbers(texts: string[], figures: number[] = []): number[] {
  const out = new Set<number>(figures.map(round));
  for (const t of texts) for (const m of extractNumbers(t)) out.add(m.value);
  return [...out];
}

/**
 * Model output is plain text for a person: no HTML, links, code or markdown beyond **bold**,
 * one short paragraph or a few lines, bounded length.
 */
export function sanitizeModelText(text: string, maxChars = 700): string {
  let t = text
    .replace(/<[^>]*>/g, "") // tags
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links and images
    .replace(/https?:\/\/\S+/g, "") // bare urls
    .replace(/^#+\s*/gm, "") // headings
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
    t = end > maxChars * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return t;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The people guard: the answer may only name people the plan text names (plus the reader).
 * Stops a model from handing a debt or policy to the wrong partner.
 */
export function checkPeople(text: string, allowedNames: string[], householdNames: string[]): { ok: boolean; unknown: string[] } {
  const allowed = new Set(allowedNames);
  const unknown = householdNames.filter((n) => !allowed.has(n) && new RegExp(`\\b${n}\\b`).test(text));
  return { ok: unknown.length === 0, unknown };
}
