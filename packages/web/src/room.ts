// The demo room: a 4-letter code in the address (?room=ABCD) that keeps one demo's taps apart from
// another's. Every API call carries it, so no screen has to think about rooms. No code: the default room.

/** The room in a query string such as "?room=abcd", or null. */
export function roomFrom(search: string): string | null {
  const r = new URLSearchParams(search).get("room")?.trim().toUpperCase() ?? "";
  return /^[A-Z]{4}$/.test(r) ? r : null;
}

/** Adds the room to a family-data API path. */
export function withRoom(path: string, room: string | null): string {
  if (!room || !path.startsWith("/api/cases/")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}room=${room}`;
}

/** A fresh room code. No vowels, so it never spells a word. */
export function newRoom(random: () => number = Math.random): string {
  const letters = "BCDFGHJKLMNPQRSTVWXZ";
  return Array.from({ length: 4 }, () => letters[Math.floor(random() * letters.length)]).join("");
}

/** A join link, /join?case=<caseId>&member=<memberId>&room=<code>: who it opens the app for. */
export function joinTarget(pathname: string, search: string): { caseId: string; member: string } | null {
  if (pathname.replace(/\/+$/, "") !== "/join") return null;
  const q = new URLSearchParams(search);
  const caseId = q.get("case") ?? "";
  const member = (q.get("member") ?? "").toLowerCase();
  return /^[a-z0-9-]+$/.test(caseId) && /^[a-z]+$/.test(member) ? { caseId, member } : null;
}

/** The join link for one person in one room. */
export function joinUrl(origin: string, caseId: string, member: string, room: string): string {
  return `${origin}/join?${new URLSearchParams({ case: caseId, member, room }).toString()}`;
}

/** This page's room. */
export const ROOM = typeof window === "undefined" ? null : roomFrom(window.location.search);
