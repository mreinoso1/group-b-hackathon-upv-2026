// The plan's own priorities: the recommendations in summary_recommendations, in the plan's
// order. They compete for the same money, and the family decides the order. Each gets a short
// plain label, the capsule that explains it, and, when the plan scores a matching move, its
// effect on the score.
import type { FutureSelf } from "./future-self.ts";
import { planMoves, type PlanMove } from "./first-step.ts";
import { at, str, type RawCase } from "./load.ts";
import { splitBullets } from "./text.ts";

export interface ScoreEffect {
  before: number;
  after: number;
  liftsACap: boolean;
  /** Best plan combination including this move, when it does more than the move alone. */
  combo?: { with: string[]; after: number };
}

export interface Priority {
  index: number;
  /** A short plain label ("Pay down the credit card"). */
  label: string;
  /** The plan's own sentence, verbatim. */
  text: string;
  /** The capsule that explains it. */
  topicId: string;
  /** What the plan says this does to the score, when it scores a matching move. */
  score?: ScoreEffect;
  /** True for steps about making savings last (retirement saving, workplace plan, tax accounts). */
  aboutSavings: boolean;
  source: string;
}

// [pattern on the plan's sentence, label, topic, about savings]. First match wins.
const KINDS: [RegExp, string, string, boolean][] = [
  [/talk through together|shared choice/i, "Agree how the yearly cash is shared", "advice.priorities", false],
  [/keep your life, disability and umbrella/i, "Keep your protection in place", "advice.protection.life_insurance", false],
  [/workplace retirement plan/i, "Check for a workplace retirement plan", "advice.retirement", true],
  [/tax-advantaged|traditional ira|\bhsa\b/i, "Open a tax-advantaged account", "advice.savings", true],
  [/retirement saving against college|college funding/i, "Balance retirement and college saving", "advice.savings", true],
  [/home purchase/i, "Plan the home purchase with your cash", "advice.protection.emergency_fund", false],
  [/keeping a cushion|near-term goals like/i, "Plan cash for the near-term bills", "advice.protection.emergency_fund", false],
  [/life insurance and umbrella/i, "Review your life and umbrella cover", "advice.protection.life_insurance", false],
  [/life (cover|insurance)|protection gaps|strengthening your protection/i, "Get the life cover you need", "advice.protection.life_insurance", false],
  [/umbrella/i, "Add an umbrella policy", "advice.protection.umbrella", false],
  [/credit card/i, "Pay down the credit card", "advice.debt", false],
  [/college/i, "Start saving for college", "advice.savings", false],
  [/cash reserve|emergency/i, "Build your cash cushion", "advice.protection.emergency_fund", false],
  [/retirement/i, "Save more for retirement", "advice.retirement", true],
  [/invested mix|stock mix|investments?/i, "Revisit your investment mix", "advice.investments", false],
];

/** Moves the plan scores, matched to a priority by the capsule they share. */
function scoreFor(topicId: string, moves: PlanMove[]): ScoreEffect | undefined {
  const move = moves.find((m) => m.topicId === topicId && !/withdrawal/i.test(m.title));
  if (!move) return undefined;
  const best = move.combos.find((c) => c.scoreAfter > move.scoreAfter);
  return {
    before: move.scoreBefore,
    after: move.scoreAfter,
    liftsACap: move.liftsACap,
    combo: best
      ? { with: best.moves.filter((t) => t !== move.title).map((t) => gerund(moves.find((m) => m.title === t)?.plainTitle ?? t)), after: best.scoreAfter }
      : undefined,
  };
}

const ING: Record<string, string> = {
  pay: "paying", get: "getting", add: "adding", insure: "insuring", take: "taking", save: "saving",
  spread: "spreading", invest: "investing", make: "making", build: "building", review: "reviewing",
};

/** "Pay down your credit card" -> "paying down your credit card", to read inside a sentence. */
export function gerund(title: string): string {
  const [first = "", ...rest] = title.split(" ");
  const ing = ING[first.toLowerCase()];
  return ing ? [ing, ...rest].join(" ") : title.charAt(0).toLowerCase() + title.slice(1);
}

export function planPriorities(raw: RawCase): Priority[] {
  const text = str(at(raw.financialHealth, "narrative.summary_recommendations")) ?? "";
  const moves = planMoves(raw);
  return splitBullets(text).map((sentence, index) => {
    const kind = KINDS.find(([re]) => re.test(sentence));
    const topicId = kind?.[2] ?? "advice.priorities";
    return {
      index,
      label: kind?.[1] ?? sentence.split(/[,.]/)[0]!.slice(0, 48),
      text: sentence,
      topicId,
      score: scoreFor(topicId, moves),
      aboutSavings: kind?.[3] ?? false,
      source: `financial-health:narrative.summary_recommendations[${index}]`,
    };
  });
}

/**
 * Which priority to put first: the plan's own order. When the plan shows savings running out,
 * the future self starts with the plan's first priority about making savings last.
 */
export function suggestPriority(priorities: Priority[], self?: FutureSelf): { index: number; because: "plan_order" | "future_self" } {
  const first = priorities[0]?.index ?? 0;
  if (self?.reason !== "savings_run_out") return { index: first, because: "plan_order" };
  const savings = priorities.find((p) => p.aboutSavings);
  return savings && savings.index !== first ? { index: savings.index, because: "future_self" } : { index: first, because: "plan_order" };
}
