// Consent (family side) and the advisor's brief and reset (advisor side).
import type { AdvisorBrief } from "@bite/plan-core";
import { request } from "./api.ts";

export type { AdvisorBrief };

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}`;
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const advisorApi = {
  /** Each adult's latest choice: true, false, or null (not asked yet). */
  consent: (caseId: string) => request<{ consent: Record<string, boolean | null> }>(`${base(caseId)}/consent`),
  setConsent: (caseId: string, member: string, share: boolean) => request<{ ok: true }>(`${base(caseId)}/consent`, post({ member, share })),
  brief: (caseId: string) => request<AdvisorBrief>(`${base(caseId)}/advisor-brief`, undefined, 0),
  reset: (caseId: string) => request<{ ok: true; removed: number }>(`${base(caseId)}/reset`, { method: "POST" }),
};
