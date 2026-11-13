import { at, isRecord, str, type RawCase } from "./load.ts";
import { sectionOf } from "./sections.ts";
import { fallbackSimple } from "./explain.ts";
import { members } from "./household.ts";
import { markdownSection, readSeconds, splitBullets, takeWithin } from "./text.ts";
import { findTopic, rootOf, srcPath, TOPICS, type TextRef, type TopicDef } from "./topics.ts";
import { REACTIONS, type Block, type Capsule, type Level } from "./types.ts";

export class UnknownTopicError extends Error {
  readonly code = "UNKNOWN_TOPIC";
  constructor(id: string) {
    super(`Unknown topic: ${id}. Valid topics: ${TOPICS.map((t) => t.id).join(", ")}`);
  }
}

const DEFAULT_BUDGET = 110; // words: about 45 seconds spoken

/** The plan's own sentences for a text reference, one block per bullet. Never rewritten. */
export function planBlocks(raw: RawCase, ref: TextRef): Block[] {
  const source = srcPath(ref);
  const value = at(rootOf(raw, ref), ref.path);
  let bullets: string[] = [];
  if (typeof value === "string") {
    bullets = ref.section ? markdownSection(value, ref.section) : splitBullets(value);
  } else if (Array.isArray(value)) {
    bullets = value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!isRecord(item)) return [];
      // goals.goalsSummary items carry a sentence in `value`; score.top_moves carry `title` + `action`.
      const sentence = str(item.value) ?? str(item.action);
      if (!sentence) return [];
      return [str(item.title) ? `**${str(item.title)}**: ${sentence}` : sentence];
    });
  }
  return bullets.map((text) => ({ text, source }));
}

export interface CapsuleRequest {
  topicId: string;
  level: Level;
  member?: string | null;
}

/**
 * Builds one capsule. Standard and expert are verbatim plan text; nothing is summarised.
 * The simple level is a deterministic fallback here (first sentence + same chart); the
 * LLM re-explanation is layered on top by the MCP server, with the plan's words kept beside it.
 */
export function buildCapsule(raw: RawCase, req: CapsuleRequest): Capsule {
  const topic = findTopic(req.topicId);
  if (!topic) throw new UnknownTopicError(req.topicId);
  const visual = topic.visual(raw);
  const main = planBlocks(raw, topic.main);
  const missing = [...visual.missing];
  if (!main.length) missing.push(srcPath(topic.main));

  const standard = takeWithin(main.map((b) => b.text), topic.budget ?? DEFAULT_BUDGET).map((text, i) => main[i]!);
  let blocks: Block[] = standard;
  let planWords: Block[] = [];
  let generatedBy: Capsule["generatedBy"] = "verbatim";

  if (req.level === "expert") {
    const rest = main.slice(standard.length);
    const extra = topic.expert.flatMap((ref) => {
      const b = planBlocks(raw, ref);
      if (!b.length) missing.push(srcPath(ref));
      return b;
    });
    blocks = [...rest, ...extra];
    if (!blocks.length) blocks = standard; // nothing more in the plan: say so via `missing`, show the core again
  } else if (req.level === "simple") {
    // Deterministic fallback; the MCP server swaps in a checked re-explanation when it can.
    const name = members(raw).find((m) => m.id === req.member)?.name;
    blocks = fallbackSimple(standard, name);
    planWords = standard;
    generatedBy = "fallback";
  }

  return {
    id: capsuleId(raw.id, topic, req),
    caseId: raw.id,
    topicId: topic.id,
    piece: topic.piece,
    level: req.level,
    member: req.member ?? null,
    title: topic.title,
    blocks,
    planWords,
    chart: visual.chart,
    figures: (req.level === "expert" ? visual.figures : visual.figures.slice(0, 4)).map((f) => ({ ...f, section: sectionOf(f.source) })),
    estSeconds: readSeconds(blocks.map((b) => b.text)),
    generatedBy,
    missing,
    reactions: [...REACTIONS],
  };
}

function capsuleId(caseId: string, topic: TopicDef, req: CapsuleRequest): string {
  return [caseId, topic.id, req.level, req.member ?? "all"].join(":");
}

/** Default reading order: overview, living map, then the advice in the plan's order. */
export function nextTopic(currentId: string): string | null {
  const i = TOPICS.findIndex((t) => t.id === currentId);
  if (i < 0) throw new UnknownTopicError(currentId);
  return TOPICS[i + 1]?.id ?? null;
}
