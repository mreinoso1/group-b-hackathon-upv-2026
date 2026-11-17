// The advisor brief: what the family understood, where they got stuck, what they asked and chose,
// so the meeting starts where they are. Pure: built only from recorded events and plan data, no
// model. A person's events appear only if they chose to share; a question they sent to the advisor
// is shared on its own. The persona is advisor-only, so its tensions may appear here.
import { agreement } from "./agreement.ts";
import { consents, isCheckin, isCommitment, isQuestion, isRanking, isReaction, type PlanEvent, type ReactionEvent } from "./events.ts";
import { EXPLAIN_STYLES, type ExplainStyle } from "./explain.ts";
import { caseSummary, members } from "./household.ts";
import type { RawCase } from "./load.ts";
import { topicOrder } from "./order.ts";
import { planPriorities } from "./priorities.ts";
import { findTopic } from "./topics.ts";

export interface Evidence {
  type: PlanEvent["type"];
  member: string;
  at: string;
  topicId?: string;
}

export interface TopicRef {
  topicId: string;
  title: string;
}

export interface Tension {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
}

export interface StuckTopic extends TopicRef {
  lostCount: number;
  /** True when a later reaction shows it landed; false when they left it lost. */
  resolved: boolean;
  /** The re-explanation they answered "Got it" to, when one did. */
  landed: ExplainStyle | null;
  personaPredicted: Tension | null;
  evidence: Evidence[];
}

export interface PersonBrief {
  memberId: string;
  name: string;
  /** Without this, the brief shows "has not shared yet" and nothing but the questions they sent. */
  shared: boolean;
  understood: TopicRef[];
  stuck: StuckTopic[];
  wantedDepth: TopicRef[];
  /** Passed over: a later idea got a reaction, this one did not. */
  skipped: TopicRef[];
  notReached: TopicRef[];
  questions: (TopicRef & { text: string; at: string })[];
  firstStep: { label: string; dueDate: string; at: string } | null;
  checkin: { label: string; status: "done" | "not_yet"; at: string } | null;
}

export interface CouplePriority {
  index: number;
  label: string;
  /** The plan's own sentence. */
  planSays: string;
  ranks: { name: string; rank: number }[];
}

export interface CoupleBrief {
  status: "not_shared" | "waiting" | "ready";
  waitingFor: string[];
  agreeOn: CouplePriority[];
  seeDifferently: CouplePriority[];
  evidence: Evidence[];
}

export interface AgendaItem {
  kind: "lost" | "couple" | "question";
  title: string;
  detail: string;
  personaPredicted: Tension | null;
  evidence: Evidence[];
}

export interface AdvisorBrief {
  caseId: string;
  household: string;
  score: number;
  band: string;
  people: PersonBrief[];
  couple: CoupleBrief | null;
  /** Every open item, by evidence: unresolved "I'm lost" first, then couple differences, then open questions. */
  agenda: AgendaItem[];
  /** Ideas everyone who read them marked "Got it" and nobody got lost on: skip them in the meeting. */
  alreadyUnderstood: TopicRef[];
  lastActivity: string | null;
}

const ref = (topicId: string): TopicRef => ({ topicId, title: findTopic(topicId)?.title ?? topicId });
const ev = (e: PlanEvent): Evidence => ({ type: e.type, member: e.member, at: e.at, ...("topicId" in e ? { topicId: e.topicId } : {}) });

// ---- persona tensions -------------------------------------------------------------------

const SEVERITY = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

// Which capsules a tension is about, from its own words. Deliberately narrow: "cash flow" is in
// most tensions, so only cash as a reserve counts.
const TENSION_TOPICS: [RegExp, string[]][] = [
  [/life insurance|insurance gaps?|protection gaps?/i, ["advice.protection.life_insurance"]],
  [/umbrella/i, ["advice.protection.umbrella"]],
  [/\bcard\b|\bdebt\b|\bloan\b/i, ["advice.debt"]],
  [/\bcash\b(?! flow)|reserve|cushion/i, ["advice.protection.emergency_fund"]],
  [/college|education|\b529\b/i, ["advice.savings", "advice.investments"]],
  [/retire/i, ["advice.retirement"]],
  [/stocks?\b|portfolio|exposure|risk/i, ["advice.investments"]],
  [/down payment|home purchase/i, ["advice.priorities"]],
];

/** The persona's tensions (T1, T2…), each with a readable summary and the capsules it touches. */
export function personaTensions(raw: RawCase): (Tension & { topics: string[] })[] {
  const out: (Tension & { topics: string[] })[] = [];
  for (const line of (raw.persona ?? "").split(/\r?\n/)) {
    // "- **T1 (HIGH):** text" or "- **T1: Title (HIGH).** text"
    const m = line.match(/^-\s+\*\*(T\d+)(?::\s*([^*(]+?))?\s*\((HIGH|MEDIUM|LOW)\)[:.]?\*\*\s*(.*)$/);
    if (!m) continue;
    const [, id, title, severity, body] = m as unknown as [string, string, string | undefined, Tension["severity"], string];
    // The first sentence that is not only codes (O1, D4a…).
    const sentences = body.split(/(?<=\.)\s+(?=[A-Z$])/);
    const readable = sentences.find((s) => s.replace(/\b[ODT]\d+[a-z]?\b|against|and|together with|,|\.|\s/gi, "").length > 25) ?? sentences[0] ?? "";
    const summary = title ? `${title.trim()}.` : readable.trim();
    const topics = [...new Set(TENSION_TOPICS.filter(([re]) => re.test(`${title ?? ""} ${body}`)).flatMap(([, t]) => t))];
    out.push({ id, severity, summary, topics });
  }
  return out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
}

/** The tension most specifically about this capsule (fewest other topics), then the most severe. */
function predicted(tensions: (Tension & { topics: string[] })[], topicId: string): Tension | null {
  const t = tensions
    .filter((x) => x.topics.includes(topicId))
    .sort((a, b) => a.topics.length - b.topics.length || SEVERITY[a.severity] - SEVERITY[b.severity])[0];
  return t ? { id: t.id, severity: t.severity, summary: t.summary } : null;
}

// ---- per person -------------------------------------------------------------------------

function personBrief(raw: RawCase, memberId: string, name: string, shared: boolean, events: PlanEvent[], tensions: (Tension & { topics: string[] })[]): PersonBrief {
  const mine = events.filter((e) => e.member === memberId);
  const questions = mine.filter(isQuestion).map((q) => ({ ...ref(q.topicId), text: q.text, at: q.at }));
  const empty = { understood: [], stuck: [], wantedDepth: [], skipped: [], notReached: [], firstStep: null, checkin: null };
  if (!shared) return { memberId, name, shared, ...empty, questions };

  const order = topicOrder(raw, memberId);
  const reactions = mine.filter(isReaction);
  const byTopic = new Map<string, ReactionEvent[]>();
  for (const r of reactions) byTopic.set(r.topicId, [...(byTopic.get(r.topicId) ?? []), r]);

  const understood: TopicRef[] = [];
  const stuck: StuckTopic[] = [];
  const wantedDepth: TopicRef[] = [];
  for (const topicId of order) {
    const rs = byTopic.get(topicId) ?? [];
    const lost = rs.filter((r) => r.reaction === "lost");
    if (lost.length) {
      const lastLost = rs.lastIndexOf(lost.at(-1)!);
      const after = rs.slice(lastLost + 1);
      const landedOn = after.find((r) => r.reaction === "got_it" && r.level === "simple");
      stuck.push({
        ...ref(topicId),
        lostCount: lost.length,
        resolved: after.length > 0,
        landed: landedOn && landedOn.attempt !== undefined ? (EXPLAIN_STYLES[Math.min(landedOn.attempt, EXPLAIN_STYLES.length - 1)] ?? null) : null,
        personaPredicted: predicted(tensions, topicId),
        evidence: [...lost, ...(landedOn ? [landedOn] : [])].map(ev),
      });
    } else if (rs.some((r) => r.reaction === "got_it" && r.level === "standard")) understood.push(ref(topicId));
    if (rs.some((r) => r.reaction === "tell_me_more")) wantedDepth.push(ref(topicId));
  }
  const furthest = Math.max(-1, ...order.map((t, i) => (byTopic.has(t) ? i : -1)));
  const commitment = mine.filter(isCommitment).at(-1);
  const checkin = mine.filter(isCheckin).at(-1);
  return {
    memberId,
    name,
    shared,
    understood,
    stuck,
    wantedDepth,
    skipped: order.slice(0, furthest).filter((t) => !byTopic.has(t)).map(ref),
    notReached: order.slice(furthest + 1).map(ref),
    questions,
    firstStep: commitment ? { label: commitment.label, dueDate: commitment.dueDate, at: commitment.at } : null,
    checkin: checkin ? { label: checkin.label, status: checkin.status, at: checkin.at } : null,
  };
}

// ---- the brief --------------------------------------------------------------------------

export function advisorBrief(raw: RawCase, events: PlanEvent[]): AdvisorBrief {
  const summary = caseSummary(raw);
  const adults = members(raw);
  const consent = consents(events);
  const tensions = personaTensions(raw);
  const allShared = adults.length > 0 && adults.every((m) => consent.get(m.id) === true);

  const people = adults.map((m) => personBrief(raw, m.id, m.name, consent.get(m.id) === true, events, tensions));
  // Reading together counts as shared only when every partner chose to share.
  if (adults.length > 1 && events.some((e) => e.member === "together")) {
    people.push(personBrief(raw, "together", "Together", allShared, events, tensions));
  }
  const nameOf = (id: string) => people.find((p) => p.memberId === id)?.name ?? id;

  // The couple: only when both chose to share ("Nothing you tap is shared until you both choose to").
  let couple: CoupleBrief | null = null;
  if (adults.length > 1) {
    if (!allShared) couple = { status: "not_shared", waitingFor: [], agreeOn: [], seeDifferently: [], evidence: [] };
    else {
      const priorities = planPriorities(raw);
      const rankings = events.filter(isRanking);
      const orders: Record<string, number[]> = {};
      for (const r of rankings) orders[r.member] = r.order;
      const a = agreement(priorities, adults.map((m) => ({ id: m.id, name: m.name })), orders);
      const item = (index: number): CouplePriority => {
        const it = a.items.find((x) => x.index === index)!;
        return { index, label: it.label, planSays: it.text, ranks: adults.map((m) => ({ name: m.name, rank: it.ranks[m.id]! })) };
      };
      couple = {
        status: a.status === "ready" ? "ready" : "waiting",
        waitingFor: a.waitingFor.map(nameOf),
        agreeOn: a.agreeOn.map(item),
        seeDifferently: a.seeDifferently.map(item),
        evidence: rankings.map(ev),
      };
    }
  }

  // Agenda: unresolved "I'm lost" (most losses first), then couple differences (widest first), then questions.
  const lostItems: (AgendaItem & { weight: number })[] = people.flatMap((p) =>
    p.stuck
      .filter((s) => !s.resolved)
      .map((s) => ({
        kind: "lost" as const,
        title: `Explain "${s.title}" again`,
        detail: `${p.name} said "I'm lost" ${s.lostCount === 1 ? "once" : `${s.lostCount} times`} and moved on without it landing.`,
        personaPredicted: s.personaPredicted,
        evidence: s.evidence,
        weight: s.lostCount,
      })),
  );
  const priorities = planPriorities(raw);
  const coupleItems: (AgendaItem & { weight: number })[] = (couple?.seeDifferently ?? []).map((c) => ({
    kind: "couple" as const,
    title: `Talk through "${c.label}" together`,
    detail: `${c.ranks.map((r) => `${r.name} put it #${r.rank}`).join(", ")}. The plan says: ${c.planSays}`,
    personaPredicted: predicted(tensions, priorities.find((p) => p.index === c.index)?.topicId ?? ""),
    evidence: couple!.evidence,
    weight: Math.max(...c.ranks.map((r) => r.rank)) - Math.min(...c.ranks.map((r) => r.rank)),
  }));
  const questionItems: AgendaItem[] = events.filter(isQuestion).map((q) => ({
    kind: "question" as const,
    title: `Answer ${nameOf(q.member)}'s question on "${ref(q.topicId).title}"`,
    detail: `"${q.text}"`,
    personaPredicted: predicted(tensions, q.topicId),
    evidence: [ev(q)],
  }));
  // Every item stays: a fourth "I'm lost" must not push an earlier one off the advisor's list.
  // Within a kind, the heavier first; ties in the order they happened, so new items join at the end.
  const firstAt = (a: AgendaItem) => a.evidence.map((e) => e.at).sort()[0] ?? "";
  const byWeight = (a: AgendaItem & { weight: number }, b: AgendaItem & { weight: number }) => b.weight - a.weight || firstAt(a).localeCompare(firstAt(b));
  const agenda = [...lostItems.sort(byWeight), ...coupleItems.sort(byWeight), ...questionItems].map(({ kind, title, detail, personaPredicted, evidence }) => ({ kind, title, detail, personaPredicted, evidence }));

  // Skippable: understood by everyone who shared and reacted to it, stuck for nobody.
  const sharers = people.filter((p) => p.shared);
  const stuckIds = new Set(sharers.flatMap((p) => p.stuck.map((s) => s.topicId)));
  const understoodIds = [...new Set(sharers.flatMap((p) => p.understood.map((u) => u.topicId)))].filter((t) => !stuckIds.has(t));

  return {
    caseId: raw.id,
    household: summary.label,
    score: summary.score,
    band: summary.band,
    people,
    couple,
    agenda,
    alreadyUnderstood: understoodIds.map(ref),
    lastActivity: events.at(-1)?.at ?? null,
  };
}
