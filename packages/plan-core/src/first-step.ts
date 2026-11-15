// The plan's own "top moves": concrete steps with their effect on the score. One is suggested
// (see suggestMove) and the family may pick another: the order is theirs.
import type { FutureSelf } from "./future-self.ts";
import { arr, at, isRecord, num, str, type RawCase } from "./load.ts";

export interface MoveCombo {
  moves: string[];
  scoreAfter: number;
  note?: string;
}

export interface PlanMove {
  index: number;
  title: string;
  /** The step in plain words, without the plan's jargon or any number ("Pay down your credit card"). */
  plainTitle: string;
  /** The plan's own sentence for the step. */
  action: string;
  effort: string;
  scoreBefore: number;
  scoreAfter: number;
  /** True when the step removes one of the limits holding the score down. */
  liftsACap: boolean;
  /** The capsule that explains this step, for "Not yet, I have a question". */
  topicId: string;
  /** Combinations from the plan that include this step, best first (score.combined_moves). */
  combos: MoveCombo[];
  source: string;
}

const TOPIC_BY_MOVE: [RegExp, string][] = [
  [/card|revolving|debt/i, "advice.debt"],
  [/life cover|mortality|life insurance/i, "advice.protection.life_insurance"],
  [/umbrella|liability/i, "advice.protection.umbrella"],
  [/coverage gap|homeowners|insurance/i, "advice.protection.umbrella"],
  [/withdrawal|retire/i, "advice.retirement"],
  [/savings|save/i, "advice.savings"],
  [/allocation|glide|concentration|growth|invest/i, "advice.investments"],
  [/emergency|cash|reserve/i, "advice.protection.emergency_fund"],
];

export function topicForMove(title: string): string {
  return TOPIC_BY_MOVE.find(([re]) => re.test(title))?.[1] ?? "advice.priorities";
}

// Plain headlines, matched on the plan's title and action. Order matters: the first match wins.
const PLAIN_BY_MOVE: [RegExp, string][] = [
  [/homeowners/i, "Insure your home"],
  [/revolving|credit card|\bcard\b/i, "Pay down your credit card"],
  [/life cover|mortality|life insurance/i, "Get more life insurance"],
  [/umbrella/i, "Add umbrella insurance"],
  [/withdrawal/i, "Take less from your savings each year"],
  [/raise (annual )?savings|save more/i, "Save more each year"],
  [/concentration/i, "Spread out your largest investment"],
  [/^raise .*(growth|glide)/i, "Invest a little more for growth"],
  [/^reduce .*(growth|glide)/i, "Make your investments a little steadier"],
];

export function plainTitle(title: string, action: string): string {
  return PLAIN_BY_MOVE.find(([re]) => re.test(title) || re.test(action))?.[1] ?? title;
}

/** Topics whose steps make savings last longer. */
const LASTING_SAVINGS = new Set(["advice.retirement", "advice.savings"]);

/**
 * Which step to put first. By default, the plan's own first move. When the plan shows savings
 * running out, the future self speaks from that year, so it starts with the plan's step that
 * does most for savings: the one with the biggest score lift among those, if there is one.
 */
export function suggestMove(moves: PlanMove[], self?: FutureSelf): { index: number; because: "plan_order" | "future_self" } {
  const first = moves[0]?.index ?? 0;
  if (self?.reason !== "savings_run_out") return { index: first, because: "plan_order" };
  const lasting = moves.filter((m) => LASTING_SAVINGS.has(m.topicId)).sort((a, b) => b.scoreAfter - a.scoreAfter)[0];
  return lasting && lasting.index !== first ? { index: lasting.index, because: "future_self" } : { index: first, because: "plan_order" };
}

export function planMoves(raw: RawCase): PlanMove[] {
  const combos: MoveCombo[] = arr(at(raw.financialHealth, "score.combined_moves")).flatMap((c) => {
    if (!isRecord(c) || num(c.score_after) === undefined) return [];
    const moves = arr(c.moves).filter((m): m is string => typeof m === "string");
    return moves.length ? [{ moves, scoreAfter: num(c.score_after)!, note: str(c.note) }] : [];
  });
  return arr(at(raw.financialHealth, "score.top_moves")).flatMap((m, index) => {
    if (!isRecord(m)) return [];
    const title = str(m.title);
    const action = str(m.action);
    const before = num(m.score_before);
    const after = num(m.score_after);
    if (!title || !action || before === undefined || after === undefined) return [];
    return [
      {
        index,
        title,
        plainTitle: plainTitle(title, action),
        action,
        effort: str(m.effort) ?? "unknown",
        scoreBefore: before,
        scoreAfter: after,
        liftsACap: m.lifts_a_cap === true,
        topicId: topicForMove(title),
        combos: combos.filter((c) => c.moves.includes(title) && c.moves.length > 1).sort((a, b) => b.scoreAfter - a.scoreAfter),
        source: `financial-health:score.top_moves[${index}]`,
      },
    ];
  });
}
