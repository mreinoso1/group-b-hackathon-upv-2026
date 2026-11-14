import type { Capsule, CaseSummary, Level, Reaction, TopicInfo } from "@bite/plan-core";

export type { Capsule, CaseSummary, Level, Reaction, TopicInfo };

export interface Next {
  topicId: string;
  level: Level;
  /** How many times this person already said "I'm lost" here: picks another way in. */
  attempt?: number;
}

export type AudioAnswer = { kind: "audio"; url: string } | { kind: "browser"; text: string; reason: string };

const RETRYABLE = new Set([502, 503, 504]);

/** One retry when the API is briefly unavailable (restarting); real errors surface at once. */
export async function request<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (retries > 0) return wait(1500).then(() => request<T>(path, init, retries - 1));
    throw new Error("Can't reach the server. Check your connection and try again.", { cause: e });
  }
  if (RETRYABLE.has(res.status) && retries > 0) return wait(1500).then(() => request<T>(path, init, retries - 1));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const api = {
  cases: () => request<{ dataSource: string; cases: CaseSummary[] }>("/api/cases"),
  topics: (caseId: string) => request<{ topics: TopicInfo[] }>(`/api/cases/${encodeURIComponent(caseId)}/topics`),
  capsule: (caseId: string, topicId: string, level: Level, member: string, attempt = 0) =>
    request<Capsule>(
      `/api/cases/${encodeURIComponent(caseId)}/capsule?` +
        new URLSearchParams({ topic: topicId, level, member, attempt: String(attempt) }).toString(),
    ),
  audio: (caseId: string, body: { topicId: string; level: Level; member: string; attempt: number }) =>
    request<AudioAnswer>(`/api/cases/${encodeURIComponent(caseId)}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  react: (caseId: string, body: { member: string; topicId: string; level: Level; reaction: Reaction; dwellMs: number }) =>
    request<{ ok: true; next: Next | null }>(`/api/cases/${encodeURIComponent(caseId)}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
