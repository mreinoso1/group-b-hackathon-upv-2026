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

export type PlanEvent = ReactionEvent;

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
