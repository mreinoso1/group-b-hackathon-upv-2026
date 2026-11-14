// The plan's own "top moves": concrete steps with their effect on the score. The app shows the
// plan's first one as the suggestion, and the family may pick another: the order is theirs.
import { arr, at, isRecord, num, str, type RawCase } from "./load.ts";

export interface MoveCombo {
  moves: string[];
  scoreAfter: number;
  note?: string;
}

export interface PlanMove {
  index: number;
  title: string;
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
