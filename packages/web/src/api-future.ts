// API calls for the future-self thread, the plan's priorities, the couple's agreement,
// commitments, check-ins and questions for the advisor.
import type { Agreement, Capsule, FutureSelf, Level, Milestone, Priority } from "@bite/plan-core";
import { request, type AudioAnswer } from "./api.ts";

export type { Agreement, FutureSelf, Priority };
export type CheckIn = Milestone & { checkInLabel: string };
export type FutureSelfView = Omit<FutureSelf, "checkIns"> & { checkIns: CheckIn[] };

export interface Commitment {
  priorityIndex: number;
  label: string;
  dueDate: string;
  member: string;
}

export interface FirstStep {
  priorities: Priority[];
  suggested: number;
  suggestedBecause: "plan_order" | "future_self" | "agreement";
  commitment: Commitment | null;
  checkins: { status: "done" | "not_yet"; at: string }[];
}

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}`;
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const futureApi = {
  futureSelves: (caseId: string, member: string) =>
    request<{ futureSelves: FutureSelfView[] }>(`${base(caseId)}/future-self?member=${encodeURIComponent(member)}`),
  firstStep: (caseId: string, member: string) => request<FirstStep>(`${base(caseId)}/first-step?member=${encodeURIComponent(member)}`),
  commit: (caseId: string, member: string, priorityIndex: number, dueDate: string) =>
    request<{ ok: true; commitment: Commitment }>(`${base(caseId)}/commitments`, json({ member, priorityIndex, dueDate })),
  rank: (caseId: string, member: string, order: number[]) =>
    request<{ ok: true; waitingFor: string[] }>(`${base(caseId)}/rankings`, json({ member, order })),
  agreement: (caseId: string) => request<Agreement>(`${base(caseId)}/agreement`),
  checkin: (caseId: string, member: string, status: "done" | "not_yet") =>
    request<{ ok: true; next: { topicId: string; level: Level; attempt: number } | null }>(`${base(caseId)}/checkins`, json({ member, status })),
  ask: (caseId: string, member: string, topicId: string, text: string) => request<{ ok: true }>(`${base(caseId)}/questions`, json({ member, topicId, text })),
  introAudio: (caseId: string, member: string) => request<AudioAnswer>(`${base(caseId)}/audio`, json({ topicId: "overview.score", member, intro: true })),
  capsule: (caseId: string, topicId: string, level: Level, member: string, attempt = 0) =>
    request<Capsule>(`${base(caseId)}/capsule?` + new URLSearchParams({ topic: topicId, level, member, attempt: String(attempt) }).toString()),
};
