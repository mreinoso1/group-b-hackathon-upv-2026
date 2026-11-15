import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Level, Reaction } from "@bite/plan-core";

export interface ReactionEvent {
  type: "reaction";
  at: string;
  caseId: string;
  member: string;
  topicId: string;
  level: Level;
  reaction: Reaction;
  dwellMs?: number;
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

/** A question the plan could not answer on screen; it goes to the advisor brief. */
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

export type PlanEvent = ReactionEvent | CommitmentEvent | CheckinEvent | RankingEvent | QuestionEvent;

export const isReaction = (e: PlanEvent): e is ReactionEvent => e.type === "reaction";
export const isCommitment = (e: PlanEvent): e is CommitmentEvent => e.type === "commitment";
export const isCheckin = (e: PlanEvent): e is CheckinEvent => e.type === "checkin";
export const isRanking = (e: PlanEvent): e is RankingEvent => e.type === "ranking";
export const isQuestion = (e: PlanEvent): e is QuestionEvent => e.type === "question";

/** What the family did, as an append-only log. Reactions feed the advisor brief later. */
export interface EventStore {
  append(event: PlanEvent): void;
  list(caseId: string): PlanEvent[];
}

export class MemoryEventStore implements EventStore {
  private events: PlanEvent[] = [];
  append(event: PlanEvent) {
    this.events.push(event);
  }
  list(caseId: string) {
    return this.events.filter((e) => e.caseId === caseId);
  }
}

export class JsonlEventStore implements EventStore {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(event: PlanEvent) {
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
  }
  list(caseId: string): PlanEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PlanEvent];
        } catch {
          return [];
        }
      })
      .filter((e) => e.caseId === caseId);
  }
}
