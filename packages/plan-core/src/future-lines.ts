// What the future self says before each capsule, and how check-ins are named.
// Templates, not a model: the only numbers they may contain are the ages and year that the
// FutureSelf already carries from the plan (checked by the number guard in tests).
import type { FutureSelf } from "./future-self.ts";
import type { Milestone } from "./types.ts";

type Line = (f: FutureSelf) => string;

const LINES: Record<string, Line> = {
  "overview.score": (f) => `It's me, ${f.name}, at ${f.age}. Before anything else, here's where we stood when we started.`,
  "overview.big_picture": (f) => `This is the whole picture we were working with at ${f.ageNow}.`,
  "map.timeline": (f) => `This is our road from ${f.ageNow} to ${f.age}. Each dot is something we planned for.`,
  "advice.protection.life_insurance": () => "Look at this one with care: it's about protecting the people who count on us.",
  "advice.protection.umbrella": () => "A quiet one, but it guards everything we're building.",
  "advice.debt": (f) => `Here's what we owed at ${f.ageNow}, and the piece that costs us the most.`,
  "advice.protection.emergency_fund": () => "This is our safety cushion, next to what the plan recommends.",
  "advice.savings": (f) => `What we put aside every year is how we get to ${f.age}.`,
  "advice.retirement": (f) => `This is the part about me, at ${f.age}. Here's what the plan sees.`,
  "advice.assets": () => "Here's what we own besides our savings.",
  "advice.investments": () => "How our money is invested shapes a lot of the road ahead.",
  "advice.priorities": () => "Last one. These all compete for the same money, and the order is yours to choose.",
};

/** When the plan shows savings running out, a few lines say so: honestly, and with hope. */
const RUN_OUT_LINES: Record<string, Line> = {
  "overview.score": (f) => `It's me, ${f.name}, at ${f.age}. The plan shows our savings running low by then, and we have time to change that.`,
  "map.timeline": (f) => `This is our road from ${f.ageNow} to ${f.age}. The savings thin out near the end: that's the part we can still change.`,
  "advice.retirement": (f) => `This is the part I care about most: making our savings last past ${f.age}.`,
};

export function futureSelfLine(f: FutureSelf, topicId: string): string {
  const line = (f.reason === "savings_run_out" ? RUN_OUT_LINES[topicId] : undefined) ?? LINES[topicId];
  return line ? line(f) : "Here's the next piece of our plan.";
}

/** The numbers a future-self line may use. */
export function futureSelfNumbers(f: FutureSelf): number[] {
  return [f.age, f.ageNow, f.year];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BEFORE: Record<string, string> = {
  REAL_ESTATE_PURCHASE: "Before your home purchase",
  VEHICLE_PURCHASE: "Before your vehicle purchase",
  COLLEGE: "Before college starts",
  RETIREMENT: "Before retirement",
};

/** "Before your home purchase · Jan 2030", "Before college starts: College Liam · Aug 2038". */
export function checkInLabel(m: Milestone): string {
  const when = `${MONTHS[Number(m.date.slice(5, 7)) - 1] ?? ""} ${m.year}`.trim();
  const lead = BEFORE[m.subType ?? ""] ?? BEFORE[m.type];
  if (!lead) return `Before ${m.label} · ${when}`;
  return m.type === "COLLEGE" || m.type === "RETIREMENT" ? `${lead}: ${m.label} · ${when}` : `${lead} · ${when}`;
}
