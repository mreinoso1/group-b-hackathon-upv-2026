// Each person's own order of capsules. The overview and the living map open, the plan's
// priorities close; in between, the advice comes in the order that fits the reader:
// steadier profiles start with protection, growth profiles with debt and investments, and
// when the plan shows savings running out, retirement comes first. Together: the plan's order.
import { futureSelf } from "./future-self.ts";
import { members } from "./household.ts";
import type { RawCase } from "./load.ts";
import { TOPICS } from "./topics.ts";

const OPENING = ["overview.score", "overview.big_picture", "map.timeline"];
const CLOSING = ["advice.priorities"];

const PROTECTION_FIRST = [
  "advice.protection.life_insurance",
  "advice.protection.umbrella",
  "advice.protection.emergency_fund",
  "advice.debt",
  "advice.savings",
  "advice.retirement",
  "advice.assets",
  "advice.investments",
];

const GROWTH_FIRST = [
  "advice.debt",
  "advice.investments",
  "advice.savings",
  "advice.retirement",
  "advice.protection.life_insurance",
  "advice.protection.umbrella",
  "advice.protection.emergency_fund",
  "advice.assets",
];

export function topicOrder(raw: RawCase, member?: string | null): string[] {
  const planOrder = TOPICS.map((t) => t.id);
  const me = member && member !== "together" ? members(raw).find((m) => m.id === member) : undefined;
  if (!me) return planOrder;
  let advice = /growth|aggressive/i.test(me.riskProfile ?? "") ? [...GROWTH_FIRST] : [...PROTECTION_FIRST];
  if (futureSelf(raw, me.id)?.reason === "savings_run_out") advice = ["advice.retirement", ...advice.filter((t) => t !== "advice.retirement")];
  const order = [...OPENING, ...advice, ...CLOSING];
  // Anything new in the catalog still appears, before the closing priorities.
  const missing = planOrder.filter((t) => !order.includes(t));
  return [...OPENING, ...advice, ...missing, ...CLOSING];
}

export function nextTopicFor(raw: RawCase, member: string | null | undefined, currentId: string): string | null {
  const order = topicOrder(raw, member);
  const i = order.indexOf(currentId);
  return i >= 0 ? (order[i + 1] ?? null) : null;
}
