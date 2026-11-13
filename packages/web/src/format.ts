import type { Unit } from "@bite/plan-core";

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Full figure, exactly as the plan has it: $150,800 or $84,577.50. */
export function money(n: number): string {
  return Number.isInteger(n) ? whole.format(n) : cents.format(n);
}

/**
 * Short form for chart labels ($1.25M, $150k), used only when it is exact.
 * Anything that would need rounding is shown in full, so a label never differs from the plan.
 */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000 && a % 10_000 === 0) return `${sign}$${a / 1_000_000}M`;
  if (a >= 1000 && a < 1_000_000 && a % 1000 === 0) return `${sign}$${a / 1000}k`;
  return money(n);
}

export function figure(value: number, unit: Unit): string {
  switch (unit) {
    case "USD":
      return money(value);
    case "%":
      return `${value}%`;
    case "months":
      return `${value} months`;
    case "years":
      return `${value} years`;
    case "score":
      return `${value}`;
  }
}

export const PIECE_LABEL = { overview: "Overview", advice: "Advice", living_map: "Living map" } as const;
