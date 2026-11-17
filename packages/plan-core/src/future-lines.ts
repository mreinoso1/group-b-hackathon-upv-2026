// What the guide says before each capsule, and how check-ins are named. The guide speaks to the
// reader ("you"); their future self is someone they meet at the end, so it is "you, at 85" here.
// Templates, not a model: the only numbers they may contain are the ages and year that the
// FutureSelf already carries from the plan (checked by the number guard in tests).
import type { FutureSelf } from "./future-self.ts";
import type { Milestone } from "./types.ts";

type Line = (f: FutureSelf) => string;

const LINES: Record<string, Line> = {
  "overview.score": () => "Here's where you stand today.",
  "overview.big_picture": (f) => `This is the whole picture, at ${f.ageNow}.`,
  "map.timeline": (f) => `This is your road from ${f.ageNow} to ${f.age}. Each dot is something you planned for.`,
  "advice.protection.life_insurance": () => "Take this one with care: it's about the people who count on you.",
  "advice.protection.umbrella": () => "A quiet one, but it guards everything you're building.",
  "advice.debt": () => "Here's what you owe today, and what each piece costs.",
  "advice.protection.emergency_fund": () => "This is your safety cushion, next to what the plan recommends.",
  "advice.savings": (f) => `What you put aside every year is how you get to ${f.age}.`,
  "advice.retirement": (f) => `This is about you, at ${f.age}. Here's what the plan sees.`,
  "advice.assets": () => "Here's what you own besides your savings.",
  "advice.investments": () => "How your money is invested shapes a lot of the road ahead.",
  "advice.priorities": () => "Last one. These all compete for the same money, and the order is yours to choose.",
};

/** When the plan shows savings running out, a few lines say so: honestly, and with hope. */
const RUN_OUT_LINES: Record<string, Line> = {
  "overview.score": () => "The plan shows your savings running low later on, and there's time to change that.",
  "map.timeline": (f) => `This is your road from ${f.ageNow} to ${f.age}. The savings thin out near the end: that's the part you can still change.`,
  "advice.retirement": (f) => `This is the part that matters most: making your savings last past ${f.age}.`,
};

/** `opens`: this is the first capsule the reader sees, so the guide starts the walk. */
export function futureSelfLine(f: FutureSelf, topicId: string, opens = false): string {
  const line = (f.reason === "savings_run_out" ? RUN_OUT_LINES[topicId] : undefined) ?? LINES[topicId];
  const text = line ? line(f) : "Here's the next piece of your plan.";
  return opens ? `Let's start, ${f.name}. ${text}` : text;
}

/** The numbers a future-self line may use. */
export function futureSelfNumbers(f: FutureSelf): number[] {
  return [f.age, f.ageNow, f.year];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Before your home purchase · Jan 2030", "Before Liam starts college · Aug 2038", "Before Emily's retirement · May 2044". */
export function checkInLabel(m: Milestone): string {
  const when = `${MONTHS[Number(m.date.slice(5, 7)) - 1] ?? ""} ${m.year}`.trim();
  const what =
    m.subType === "REAL_ESTATE_PURCHASE"
      ? "your home purchase"
      : m.subType === "VEHICLE_PURCHASE"
        ? "your vehicle purchase"
        : m.type === "COLLEGE"
          ? `${m.label.replace(/^College\s+/i, "")} starts college`
          : m.type === "RETIREMENT"
            ? m.label.replace(/Retirement$/, "retirement")
            : m.label.charAt(0).toLowerCase() + m.label.slice(1);
  return `Before ${what} · ${when}`;
}
