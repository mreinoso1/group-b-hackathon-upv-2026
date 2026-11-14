// API calls for the future-self thread, the first step and check-ins.
import type { Capsule, FutureSelf, Level, Milestone, PlanMove } from "@bite/plan-core";
import { request } from "./api.ts";

export type { FutureSelf, PlanMove };
export type CheckIn = Milestone & { checkInLabel: string };
export type FutureSelfView = Omit<FutureSelf, "checkIns"> & { checkIns: CheckIn[] };

export interface Commitment {
  moveIndex: number;
  moveTitle: string;
  dueDate: string;
  member: string;
}

export interface FirstStep {
  moves: PlanMove[];
  suggested: number;
  commitment: Commitment | null;
  checkins: { status: "done" | "not_yet"; at: string }[];
}

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}`;
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const futureApi = {
  futureSelves: (caseId: string, member: string) =>
    request<{ futureSelves: FutureSelfView[] }>(`${base(caseId)}/future-self?member=${encodeURIComponent(member)}`),
  firstStep: (caseId: string, member: string) => request<FirstStep>(`${base(caseId)}/first-step?member=${encodeURIComponent(member)}`),
  commit: (caseId: string, member: string, moveIndex: number, dueDate: string) =>
    request<{ ok: true; commitment: Commitment }>(`${base(caseId)}/commitments`, json({ member, moveIndex, dueDate })),
  checkin: (caseId: string, member: string, status: "done" | "not_yet") =>
    request<{ ok: true; next: { topicId: string; level: Level; attempt: number } | null }>(`${base(caseId)}/checkins`, json({ member, status })),
  introAudio: (caseId: string, member: string) =>
    request<{ kind: "audio"; url: string } | { kind: "browser"; text: string; reason: string }>(
      `${base(caseId)}/audio`,
      json({ topicId: "overview.score", member, intro: true }),
    ),
  capsule: (caseId: string, topicId: string, level: Level, member: string, attempt = 0) =>
    request<Capsule>(`${base(caseId)}/capsule?` + new URLSearchParams({ topic: topicId, level, member, attempt: String(attempt) }).toString()),
};
