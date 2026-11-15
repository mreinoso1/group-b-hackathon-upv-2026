// Future You: who speaks to each person, from which age, and when they come back.
// Pure data logic: every age, year and number comes from the plan JSON. No network, no model.

import { arr, at, isRecord, num } from "./load.ts";
import type { RawCase } from "./load.ts";
import { members, milestones } from "./household.ts";
import type { Member, Milestone } from "./types.ts";

/** Why the future self speaks from that age. */
export type FutureSelfReason = "savings_run_out" | "retirement";

export interface FutureSelf {
  memberId: string;
  name: string;
  /** Age today, from the plan. */
  ageNow: number;
  /** Age the future self speaks from. */
  age: number;
  /** Calendar year of that age, from the plan's yearly projection. */
  year: number;
  reason: FutureSelfReason;
  /** Short opening line, built only from plan values (safe to show without a model). */
  introText: string;
  /** Upcoming plan dates when the future self should check in again. */
  checkIns: Milestone[];
}

interface YearRow {
  year: number;
  ageClient: number | undefined;
  ageCoClient: number | undefined;
  investable: number | undefined;
}

function yearly(raw: RawCase): YearRow[] {
  return arr(at(raw.financialHealth, "projections.yearly"))
    .filter(isRecord)
    .map((r) => ({
      year: num(r.year) ?? NaN,
      ageClient: num(r.age_client),
      ageCoClient: num(r.age_co_client),
      investable: num(r.investable_assets),
    }))
    .filter((r) => Number.isFinite(r.year));
}

function ageIn(row: YearRow, m: Member): number | undefined {
  return m.role === "co-client" ? row.ageCoClient : row.ageClient;
}

/**
 * The last year in which savings are still there, if the plan says they run out.
 * We read it from the projection (last year with investable assets >= 0 before they turn negative),
 * so it matches the plan's own wording ("savings run out at 85").
 */
function lastYearWithSavings(raw: RawCase): YearRow | undefined {
  const rows = yearly(raw);
  const firstNegative = rows.findIndex((r) => r.investable !== undefined && r.investable < 0);
  if (firstNegative <= 0) return undefined;
  return rows[firstNegative - 1];
}

/** Names joined for speech: "Liam", "Liam and Josh", "Ava, Ethan and Liam". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What the plan puts on the way to retirement, in plain words: the home purchase and the children's
 * college, only if they fall before that year. Years and names come from the plan's milestones.
 */
function onTheWay(ms: Milestone[], untilYear: number): string | undefined {
  const before = ms.filter((x) => !x.distress && x.year < untilYear);
  const parts: string[] = [];
  const home = before.find((x) => x.type === "PURCHASE" && (x.subType === "REAL_ESTATE_PURCHASE" || /home|house/i.test(x.label)));
  if (home) parts.push("our home");
  const kids = before.filter((x) => x.type === "COLLEGE").map((x) => x.label.replace(/^college\s+/i, "").trim()).filter(Boolean);
  if (kids.length) parts.push(`college for ${joinNames(kids)}`);
  return parts.length ? parts.join(" and ") : undefined;
}

/** The plan's retirement shortfall, if it shows one (0 means the plan funds retirement). */
function retirementGap(raw: RawCase): number {
  return num(at(raw.financialHealth, "key_metrics.protection.emergencyFund.retirementAndEducationGaps.retirementGap")) ?? 0;
}

function intro(m: Member, age: number, reason: FutureSelfReason, way?: string, shortfall = false): string {
  if (reason === "savings_run_out")
    return `Hey ${m.name}. It's you, at ${age}. The plan shows our savings running out around now, and we still have time to change that. Let's start this week.`;
  // When the plan shows a retirement shortfall, the future self doesn't claim the plan gets us there.
  if (shortfall)
    return way
      ? `Hey ${m.name}. It's you, at ${age}, the year we retire. Before then, the plan includes ${way}, and a gap in our retirement savings still to close. It all starts with one thing this week.`
      : `Hey ${m.name}. It's you, at ${age}, the year we retire. The plan shows a gap in our retirement savings still to close. It all starts with one thing this week.`;
  return way
    ? `Hey ${m.name}. It's you, at ${age}, the year we retire. The plan gets us here with ${way} along the way. It all starts with one thing this week.`
    : `Hey ${m.name}. It's you, at ${age}, the year we retire. Here's what got us here, and the one thing to do this week.`;
}

/** One future self per adult in the household. */
export function futureSelves(raw: RawCase, today = new Date()): FutureSelf[] {
  const depletion = lastYearWithSavings(raw);
  const rows = yearly(raw);
  const todayIso = today.toISOString().slice(0, 10);
  const allMilestones = milestones(raw);
  const checkIns = allMilestones
    .filter((ms) => !ms.distress && ms.type !== "VACATION" && ms.date >= todayIso)
    .slice(0, 6);

  const out: FutureSelf[] = [];
  for (const m of members(raw)) {
    let reason: FutureSelfReason;
    let row: YearRow | undefined;
    if (depletion && ageIn(depletion, m) !== undefined) {
      reason = "savings_run_out";
      row = depletion;
    } else if (m.retirementAge !== undefined) {
      reason = "retirement";
      row = rows.find((r) => ageIn(r, m) === m.retirementAge);
    }
    const age = row ? ageIn(row, m) : undefined;
    if (!row || age === undefined) continue; // the plan doesn't say: no future self rather than a guess
    out.push({
      memberId: m.id,
      name: m.name,
      ageNow: m.age,
      age,
      year: row.year,
      reason: reason!,
      introText: intro(m, age, reason!, reason! === "retirement" ? onTheWay(allMilestones, row.year) : undefined, retirementGap(raw) > 0),
      checkIns,
    });
  }
  return out;
}

/** The future self of one member, or undefined if the plan doesn't give enough to build it. */
export function futureSelf(raw: RawCase, memberId: string, today = new Date()): FutureSelf | undefined {
  return futureSelves(raw, today).find((f) => f.memberId === memberId.toLowerCase());
}
