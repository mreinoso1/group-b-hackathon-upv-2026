import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlanEvent } from "@bite/plan-core";

// The event types live in plan-core, which builds the advisor brief from them.
export {
  isCheckin,
  isCommitment,
  isConsent,
  isQuestion,
  isRanking,
  isReaction,
  type CheckinEvent,
  type CommitmentEvent,
  type ConsentEvent,
  type PlanEvent,
  type QuestionEvent,
  type RankingEvent,
  type ReactionEvent,
} from "@bite/plan-core";

const sameRoom = (e: PlanEvent, caseId: string, room?: string) => e.caseId === caseId && (e.room ?? "") === (room ?? "");

/** What the family did, as an append-only log. Reactions feed the advisor brief later. */
export interface EventStore {
  append(event: PlanEvent): void;
  list(caseId: string): PlanEvent[];
  /** Forgets everything recorded for one family in one room (the advisor screen's Reset, for demos). */
  clear(caseId: string, room?: string): number;
}

export class MemoryEventStore implements EventStore {
  private events: PlanEvent[] = [];
  append(event: PlanEvent) {
    this.events.push(event);
  }
  list(caseId: string) {
    return this.events.filter((e) => e.caseId === caseId);
  }
  clear(caseId: string, room?: string) {
    const before = this.events.length;
    this.events = this.events.filter((e) => !sameRoom(e, caseId, room));
    return before - this.events.length;
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
    return this.all().filter((e) => e.caseId === caseId);
  }
  clear(caseId: string, room?: string): number {
    const all = this.all();
    const keep = all.filter((e) => !sameRoom(e, caseId, room));
    writeFileSync(this.file, keep.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
    return all.length - keep.length;
  }
  private all(): PlanEvent[] {
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
      });
  }
}
