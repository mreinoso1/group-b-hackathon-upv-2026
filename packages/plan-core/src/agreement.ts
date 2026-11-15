// The couple's agreement point: each partner orders the plan's priorities; this shows where
// they agree and where they don't, quoting the plan. It never ranks for them: the shared first
// is simply the one they put highest together (ties go to the plan's own order).
import type { Priority } from "./priorities.ts";

export interface AgreementItem {
  index: number;
  label: string;
  text: string;
  /** Position each member gave it, 1 = first. */
  ranks: Record<string, number>;
  /** Difference between the highest and lowest position given. */
  spread: number;
}

export interface Agreement {
  status: "waiting" | "ready" | "single_member";
  waitingFor: string[];
  /** Ordered by combined position (best first). */
  items: AgreementItem[];
  /** The priority both put highest together, or null until everyone has ranked. */
  sharedFirst: number | null;
  /** Priorities everyone put in their top two. */
  agreeOn: number[];
  /** Priorities placed three or more positions apart. */
  seeDifferently: number[];
  summary: string;
  note: string;
}

const NOTE = "The plan lists these in its own order. They compete for the same money; the order you choose is yours.";

/** `order` is a member's priority indexes, first to last. Invalid orders are ignored. */
export function agreement(priorities: Priority[], members: { id: string; name: string }[], orders: Record<string, number[]>): Agreement {
  const valid = (o?: number[]) => !!o && o.length === priorities.length && new Set(o).size === o.length && o.every((i) => priorities.some((p) => p.index === i));
  if (members.length < 2) return { status: "single_member", waitingFor: [], items: [], sharedFirst: null, agreeOn: [], seeDifferently: [], summary: "", note: NOTE };
  const waitingFor = members.filter((m) => !valid(orders[m.id])).map((m) => m.id);
  if (waitingFor.length) return { status: "waiting", waitingFor, items: [], sharedFirst: null, agreeOn: [], seeDifferently: [], summary: "", note: NOTE };

  const items: AgreementItem[] = priorities.map((p) => {
    const ranks = Object.fromEntries(members.map((m) => [m.id, orders[m.id]!.indexOf(p.index) + 1]));
    const values = Object.values(ranks);
    return { index: p.index, label: p.label, text: p.text, ranks, spread: Math.max(...values) - Math.min(...values) };
  });
  const total = (i: AgreementItem) => Object.values(i.ranks).reduce((a, b) => a + b, 0);
  items.sort((a, b) => total(a) - total(b) || a.index - b.index);

  const agreeOn = items.filter((i) => Object.values(i.ranks).every((r) => r <= 2)).map((i) => i.index);
  const seeDifferently = items.filter((i) => i.spread >= 3).map((i) => i.index);
  const label = (i: number) => priorities.find((p) => p.index === i)!.label.toLowerCase();
  const firsts = members.map((m) => ({ name: m.name, first: orders[m.id]![0]! }));
  const sharedFirst = items[0]!.index;

  const parts: string[] = [];
  if (firsts.every((f) => f.first === firsts[0]!.first)) parts.push(`You both put "${label(firsts[0]!.first)}" first.`);
  else parts.push(`${firsts.map((f) => `${f.name} put "${label(f.first)}" first`).join(" and ")}. Together, "${label(sharedFirst)}" comes out on top.`);
  for (const i of seeDifferently) {
    const it = items.find((x) => x.index === i)!;
    parts.push(`You see "${label(i)}" differently: ${members.map((m) => `${m.name} #${it.ranks[m.id]}`).join(", ")}.`);
  }

  return { status: "ready", waitingFor: [], items, sharedFirst, agreeOn, seeDifferently, summary: parts.join(" "), note: NOTE };
}
