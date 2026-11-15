// What a family does in the app, as recorded by plan-coach. Pure types: plan-core reads them to
// build the advisor brief; plan-coach stores them (data/events.jsonl).
import type { Level, Reaction } from "./types.ts";

export interface ReactionEvent {
  type: "reaction";
  at: string;
  caseId: string;
  member: string;
  topicId: string;
  level: Level;
  reaction: Reaction;
  dwellMs?: number;
  /** For a simple capsule: which re-explanation it answered (0 plain words, 1 one number, 2 analogy). */
  attempt?: number;
}

/** "I'll do it by…": the plan priority a member (or the couple, "together") chose, and their date. */
export interface CommitmentEvent {
  type: "commitment";
  at: string;
  caseId: string;
  member: string;
  priorityIndex: number;
  label: string;
  dueDate: string; // YYYY-MM-DD
}

/** A partner's order of the plan's priorities (indexes, first to last). */
export interface RankingEvent {
  type: "ranking";
  at: string;
  caseId: string;
  member: string;
  order: number[];
}

/** A question sent to the advisor. Sending it is consent to share that question, and only it. */
export interface QuestionEvent {
  type: "question";
  at: string;
  caseId: string;
  member: string;
  topicId: string;
  text: string;
}

/** The answer to a future-self check-in ("Did you do it?"). */
export interface CheckinEvent {
  type: "checkin";
  at: string;
  caseId: string;
  member: string;
  label: string;
  status: "done" | "not_yet";
}

/** A person's choice to share (or not) how it went with their advisor. The latest one counts. */
export interface ConsentEvent {
  type: "consent";
  at: string;
  caseId: string;
  member: string;
  share: boolean;
}

export type PlanEvent = ReactionEvent | CommitmentEvent | CheckinEvent | RankingEvent | QuestionEvent | ConsentEvent;

export const isReaction = (e: PlanEvent): e is ReactionEvent => e.type === "reaction";
export const isCommitment = (e: PlanEvent): e is CommitmentEvent => e.type === "commitment";
export const isCheckin = (e: PlanEvent): e is CheckinEvent => e.type === "checkin";
export const isRanking = (e: PlanEvent): e is RankingEvent => e.type === "ranking";
export const isQuestion = (e: PlanEvent): e is QuestionEvent => e.type === "question";
export const isConsent = (e: PlanEvent): e is ConsentEvent => e.type === "consent";

/** Each member's latest choice: true shares, false declines, missing means not asked yet. */
export function consents(events: PlanEvent[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of events) if (isConsent(e)) out.set(e.member, e.share);
  return out;
}
