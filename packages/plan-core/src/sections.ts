// Turns a JSON source path into the place a family would find it in their Sherpas plan.
// Section names follow the plan's own headings (Advice tab and Living map).

const SECTIONS: [prefix: string, label: string][] = [
  ["financial-health:key_metrics.protection.emergencyFund", "Insurance & Protection · Emergency fund"],
  ["financial-health:key_metrics.protection.lifeInsurance", "Insurance & Protection · Life insurance"],
  ["financial-health:key_metrics.protection.umbrellaInsurance", "Insurance & Protection · Umbrella"],
  ["financial-health:profile.insurance", "Insurance & Protection"],
  ["financial-health:profile.liabilities", "Debt management"],
  ["financial-health:profile.accounts", "Assets & Investments · Accounts"],
  ["financial-health:profile.other_assets", "Assets & Investments"],
  ["financial-health:score", "Financial Health Score"],
  ["financial-health:projections", "Living map"],
  ["financial-health:goals", "Retirement & Goals"],
  ["financial-health:narrative.summary", "Summary"],
  ["financial-health:narrative.retirement", "Retirement & Goals"],
  ["financial-health:narrative.assets", "Assets & Investments"],
  ["financial-health:narrative.debt", "Debt management"],
  ["financial-health:narrative.savings", "Savings & Expenses"],
  ["financial-health:narrative.protection", "Insurance & Protection"],
  ["investment-analysis:positions", "Investment analysis · Holdings"],
  ["investment-analysis:", "Investment analysis"],
];

export function sectionOf(source: string): string {
  return SECTIONS.find(([prefix]) => source.startsWith(prefix))?.[1] ?? "Your plan";
}
