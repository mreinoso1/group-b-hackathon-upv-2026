import { members, milestones } from "./household.ts";
import { arr, at, isRecord, num, str, type Json, type RawCase } from "./load.ts";
import type { ChartSpec, Figure, Piece, TopicInfo } from "./types.ts";

/** Where a capsule's words come from. "fh" = financial-health.json, "ia" = investment-analysis.json. */
export interface TextRef {
  file: "fh" | "ia";
  path: string;
  /** Optional "## Heading" inside a markdown text. */
  section?: string;
}

export interface Visual {
  chart: ChartSpec | null;
  figures: Figure[];
  missing: string[];
}

export interface TopicDef {
  id: string;
  piece: Piece;
  title: string;
  /** Main text: the standard capsule takes its first bullets, expert takes the rest. */
  main: TextRef;
  /** Extra plan text shown only at the expert level. */
  expert: TextRef[];
  visual: (raw: RawCase) => Visual;
  /** Max words for the standard capsule (30–60 s spoken). */
  budget?: number;
}

export const srcPath = (ref: TextRef) =>
  `${ref.file === "fh" ? "financial-health" : "investment-analysis"}:${ref.path}${ref.section ? `#${ref.section}` : ""}`;

const fh = (path: string, section?: string): TextRef => ({ file: "fh", path, section });
const ia = (path: string): TextRef => ({ file: "ia", path });
const FH = "financial-health:";
const IA = "investment-analysis:";

// ---- visuals: each one reads only numbers that exist in the plan JSON ------------------

function scoreVisual(raw: RawCase): Visual {
  const d = raw.financialHealth;
  const score = num(at(d, "score.published_score"));
  if (score === undefined) return { chart: null, figures: [], missing: [`${FH}score.published_score`] };
  const pillars = arr(at(d, "score.pillars")).flatMap((p, i) =>
    isRecord(p) && str(p.pillar) && num(p.score) !== undefined
      ? [{ label: str(p.pillar)!, score: num(p.score)!, i }]
      : [],
  );
  const figures: Figure[] = [
    { label: "Financial health score", value: score, unit: "score", source: `${FH}score.published_score` },
    ...pillars.map((p) => ({ label: p.label, value: p.score, unit: "score" as const, source: `${FH}score.pillars[${p.i}].score` })),
  ];
  arr(at(d, "score.caps_applied")).forEach((c, i) => {
    if (isRecord(c) && str(c.reason) && num(c.score_capped_at) !== undefined)
      figures.push({ label: `Capped by: ${str(c.reason)}`, value: num(c.score_capped_at)!, unit: "score", source: `${FH}score.caps_applied[${i}].score_capped_at` });
  });
  return {
    chart: { kind: "score", score, band: str(at(d, "score.band")) ?? "", colour: str(at(d, "score.colour")), pillars: pillars.map(({ label, score }) => ({ label, score })), source: `${FH}score` },
    figures,
    missing: [],
  };
}

function accountsVisual(raw: RawCase): Visual {
  const bars: { label: string; value: number }[] = [];
  const figures: Figure[] = [];
  arr(at(raw.financialHealth, "profile.accounts")).forEach((a, i) => {
    if (!isRecord(a) || !str(a.name) || num(a.balance) === undefined) return;
    bars.push({ label: str(a.name)!, value: num(a.balance)! });
    figures.push({ label: `${str(a.name)} balance`, value: num(a.balance)!, unit: "USD", source: `${FH}profile.accounts[${i}].balance` });
  });
  if (!bars.length) return { chart: null, figures, missing: [`${FH}profile.accounts`] };
  bars.sort((a, b) => b.value - a.value);
  return { chart: { kind: "bars", title: "Where your savings sit today", unit: "USD", bars, source: `${FH}profile.accounts` }, figures, missing: [] };
}

function otherAssetsVisual(raw: RawCase): Visual {
  const bars: { label: string; value: number }[] = [];
  const figures: Figure[] = [];
  arr(at(raw.financialHealth, "profile.other_assets")).forEach((a, i) => {
    if (!isRecord(a) || !str(a.name) || num(a.value) === undefined) return;
    bars.push({ label: str(a.name)!, value: num(a.value)! });
    figures.push({ label: `${str(a.name)} value`, value: num(a.value)!, unit: "USD", source: `${FH}profile.other_assets[${i}].value` });
  });
  if (!bars.length) return { chart: null, figures, missing: [`${FH}profile.other_assets`] };
  bars.sort((a, b) => b.value - a.value);
  return { chart: { kind: "bars", title: "What you own beyond your savings", unit: "USD", bars, source: `${FH}profile.other_assets` }, figures, missing: [] };
}

function debtVisual(raw: RawCase): Visual {
  const rows: { label: string; value: number; rate: number }[] = [];
  const figures: Figure[] = [];
  arr(at(raw.financialHealth, "profile.liabilities")).forEach((l, i) => {
    if (!isRecord(l) || !str(l.name) || num(l.balance) === undefined) return;
    const rate = num(l.interest_rate) ?? 0;
    rows.push({ label: str(l.name)!, value: num(l.balance)!, rate });
    figures.push({ label: `${str(l.name)} balance`, value: num(l.balance)!, unit: "USD", source: `${FH}profile.liabilities[${i}].balance` });
    if (num(l.interest_rate) !== undefined)
      figures.push({ label: `${str(l.name)} interest rate`, value: round(rate * 100), unit: "%", source: `${FH}profile.liabilities[${i}].interest_rate` });
    if (num(l.monthly_payment) !== undefined)
      figures.push({ label: `${str(l.name)} monthly payment`, value: num(l.monthly_payment)!, unit: "USD", source: `${FH}profile.liabilities[${i}].monthly_payment` });
  });
  if (!rows.length) return { chart: null, figures, missing: [`${FH}profile.liabilities`] };
  const maxRate = Math.max(...rows.map((r) => r.rate));
  return {
    chart: {
      kind: "bars",
      title: "What you owe, and what it costs",
      unit: "USD",
      bars: rows.map((r) => ({ label: r.label, value: r.value, note: `${round(r.rate * 100)}%`, highlight: r.rate === maxRate })),
      source: `${FH}profile.liabilities`,
    },
    figures,
    missing: [],
  };
}

const EF = "key_metrics.protection.emergencyFund";
function emergencyVisual(raw: RawCase): Visual {
  const d = raw.financialHealth;
  const cash = num(at(d, `${EF}.cashAndExpensesOverview.cashReserves`));
  const min = num(at(d, `${EF}.recommendedEmergencyFundLevels.minimumAmountRecommended`));
  const max = num(at(d, `${EF}.recommendedEmergencyFundLevels.maximumAmountRecommended`));
  const minM = num(at(d, `${EF}.recommendedEmergencyFundLevels.minimumMonthsRecommended`));
  const maxM = num(at(d, `${EF}.recommendedEmergencyFundLevels.maximumMonthsRecommended`));
  const months = num(at(d, `${EF}.emergencyFundCoverageEvaluation.monthsCovered`));
  const missing = [
    cash === undefined && `${FH}${EF}.cashAndExpensesOverview.cashReserves`,
    min === undefined && `${FH}${EF}.recommendedEmergencyFundLevels.minimumAmountRecommended`,
    max === undefined && `${FH}${EF}.recommendedEmergencyFundLevels.maximumAmountRecommended`,
  ].filter((x): x is string => Boolean(x));
  const figures: Figure[] = [];
  if (cash !== undefined) figures.push({ label: "Cash reserves", value: cash, unit: "USD", source: `${FH}${EF}.cashAndExpensesOverview.cashReserves` });
  if (min !== undefined) figures.push({ label: "Recommended reserve, low end", value: min, unit: "USD", source: `${FH}${EF}.recommendedEmergencyFundLevels.minimumAmountRecommended` });
  if (max !== undefined) figures.push({ label: "Recommended reserve, high end", value: max, unit: "USD", source: `${FH}${EF}.recommendedEmergencyFundLevels.maximumAmountRecommended` });
  if (months !== undefined) figures.push({ label: "Months of expenses covered", value: months, unit: "months", source: `${FH}${EF}.emergencyFundCoverageEvaluation.monthsCovered` });
  if (cash === undefined || min === undefined || max === undefined) return { chart: null, figures, missing };
  return {
    chart: {
      kind: "range",
      title: "Your cash cushion against the recommended reserve",
      value: cash,
      valueLabel: months !== undefined ? `Your cash: about ${months} months` : "Your cash",
      min,
      max,
      rangeLabel: minM !== undefined && maxM !== undefined ? `Recommended: ${minM} to ${maxM} months` : "Recommended reserve",
      source: `${FH}${EF}`,
    },
    figures,
    missing,
  };
}

const LI = "key_metrics.protection.lifeInsurance";
function lifeVisual(raw: RawCase): Visual {
  const d = raw.financialHealth;
  const ms = members(raw);
  const rows: { label: string; have: number; need: number; needLabel: string }[] = [];
  const figures: Figure[] = [];
  const missing: string[] = [];
  ms.forEach((m) => {
    const who = m.role === "client" ? "Client" : "CoClient";
    const haveP = `${LI}.lifeInsuranceCoverageBasics.lifeInsuranceAmount${who}`;
    const needP = `${LI}.lifeInsuranceCoverageRecommendations.${m.role === "client" ? "client" : "coClient"}MinRecommendedCoverage`;
    const have = num(at(d, haveP)) ?? 0;
    const need = num(at(d, needP));
    if (need === undefined) {
      missing.push(FH + needP);
      return;
    }
    rows.push({ label: m.name, have, need, needLabel: "recommended minimum" });
    figures.push({ label: `${m.name}'s life cover`, value: have, unit: "USD", source: FH + haveP });
    figures.push({ label: `${m.name}'s recommended minimum`, value: need, unit: "USD", source: FH + needP });
    const shortP = `${LI}.lifeInsuranceCoverageGapsAndExcess.${m.role === "client" ? "client" : "coClient"}Shortfall`;
    const short = num(at(d, shortP));
    if (short !== undefined) figures.push({ label: `${m.name}'s shortfall`, value: short, unit: "USD", source: FH + shortP });
  });
  if (!rows.length) return { chart: null, figures, missing };
  return { chart: { kind: "have-need", title: "Life cover you have, against the recommended minimum", rows, source: FH + LI }, figures, missing };
}

const UM = "key_metrics.protection.umbrellaInsurance";
function umbrellaVisual(raw: RawCase): Visual {
  const d = raw.financialHealth;
  const has = at(d, `${UM}.umbrellaCoverage.hasUmbrellaPolicy`) === true;
  const have = has ? num(at(d, `${UM}.umbrellaCoverage.umbrellaCoverageAmount`)) ?? 0 : 0;
  const needP = `${UM}.coverageRecommendationsAndAnalysis.umbrellaMinRecommendedCoverage`;
  const need = num(at(d, needP));
  const nwP = `${UM}.assetExposed.netWorth`;
  const nw = num(at(d, nwP));
  const haveSource = has ? `${UM}.umbrellaCoverage.umbrellaCoverageAmount` : `${UM}.umbrellaCoverage.hasUmbrellaPolicy`;
  const figures: Figure[] = [{ label: "Umbrella cover today", value: have, unit: "USD", source: FH + haveSource }];
  if (need !== undefined) figures.push({ label: "Recommended umbrella minimum", value: need, unit: "USD", source: FH + needP });
  if (nw !== undefined) figures.push({ label: "Net worth a claim could reach", value: nw, unit: "USD", source: FH + nwP });
  if (need === undefined) return { chart: null, figures, missing: [FH + needP] };
  return {
    chart: { kind: "have-need", title: "Liability cover you have, against the recommended minimum", rows: [{ label: "Umbrella", have, need, needLabel: "recommended minimum" }], source: FH + UM },
    figures,
    missing: [],
  };
}

function contributionsVisual(raw: RawCase): Visual {
  const bars: { label: string; value: number; note?: string }[] = [];
  const figures: Figure[] = [];
  arr(at(raw.financialHealth, "profile.accounts")).forEach((a, i) => {
    if (!isRecord(a) || !str(a.name)) return;
    const total = num(a.yearly_contribution_total);
    if (!total) return;
    const match = num(a.yearly_employer_match) ?? 0;
    bars.push({ label: str(a.name)!, value: total, note: match ? `incl. employer match` : undefined });
    figures.push({ label: `${str(a.name)} saved each year`, value: total, unit: "USD", source: `${FH}profile.accounts[${i}].yearly_contribution_total` });
    if (match) figures.push({ label: `${str(a.name)} employer match`, value: match, unit: "USD", source: `${FH}profile.accounts[${i}].yearly_employer_match` });
  });
  if (!bars.length) return { chart: null, figures, missing: [`${FH}profile.accounts[].yearly_contribution_total`] };
  bars.sort((a, b) => b.value - a.value);
  return { chart: { kind: "bars", title: "What goes into each account every year", unit: "USD", bars, source: `${FH}profile.accounts` }, figures, missing: [] };
}

function positionsVisual(raw: RawCase): Visual {
  const rows: { label: string; value: number; i: number }[] = [];
  arr(at(raw.investmentAnalysis, "positions")).forEach((p, i) => {
    if (!isRecord(p) || num(p.value) === undefined) return;
    const label = str(p.ticker) ?? str(p.name) ?? "Holding";
    rows.push({ label: str(p.account) ? `${label} · ${str(p.account)}` : label, value: num(p.value)!, i });
  });
  if (!rows.length) return { chart: null, figures: [], missing: [`${IA}positions`] };
  rows.sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 6);
  return {
    chart: { kind: "bars", title: "Your largest holdings", unit: "USD", bars: top.map(({ label, value }) => ({ label, value })), source: `${IA}positions` },
    figures: top.map((r) => ({ label: r.label, value: r.value, unit: "USD" as const, source: `${IA}positions[${r.i}].value` })),
    missing: [],
  };
}

function timeline(raw: RawCase, opts: { onlyRetirement?: boolean }): Visual {
  const points: { year: number; value: number; age?: number }[] = [];
  arr(at(raw.financialHealth, "projections.yearly")).forEach((y) => {
    if (isRecord(y) && num(y.year) !== undefined && num(y.net_worth_todays_dollars) !== undefined)
      points.push({ year: num(y.year)!, value: num(y.net_worth_todays_dollars)!, age: num(y.age_client) });
  });
  if (!points.length) return { chart: null, figures: [], missing: [`${FH}projections.yearly`] };
  let ms = milestones(raw);
  if (opts.onlyRetirement) ms = ms.filter((m) => m.type === "RETIREMENT" || m.distress);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return {
    chart: {
      kind: "timeline",
      title: "Your net worth, year by year (today's dollars)",
      seriesLabel: "Net worth in today's dollars",
      points,
      milestones: ms,
      source: `${FH}projections.yearly`,
    },
    figures: [
      { label: `Net worth in ${first.year} (today's dollars)`, value: first.value, unit: "USD", source: `${FH}projections.yearly[0].net_worth_todays_dollars` },
      { label: `Net worth in ${last.year} (today's dollars)`, value: last.value, unit: "USD", source: `${FH}projections.yearly[${points.length - 1}].net_worth_todays_dollars` },
    ],
    missing: [],
  };
}

const none = (): Visual => ({ chart: null, figures: [], missing: [] });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- the catalog: default order of the daily capsules --------------------------------

export const TOPICS: readonly TopicDef[] = [
  { id: "overview.score", piece: "overview", title: "Your score, in one look", main: fh("score.message"), expert: [fh("score.explainer", "Key takeaways")], visual: scoreVisual },
  { id: "overview.big_picture", piece: "overview", title: "The big picture", main: fh("narrative.summary_main"), expert: [], visual: accountsVisual },
  { id: "map.timeline", piece: "living_map", title: "Your life, year by year", main: fh("goals.goalsSummary"), expert: [], visual: (r) => timeline(r, {}), budget: 120 },
  { id: "advice.protection.life_insurance", piece: "advice", title: "Life insurance", main: fh("narrative.protection_life_insurance_short_observations"), expert: [fh("score.explainer", "Protection")], visual: lifeVisual },
  { id: "advice.protection.umbrella", piece: "advice", title: "Umbrella cover", main: fh("narrative.protection_umbrella_short_observations"), expert: [], visual: umbrellaVisual },
  { id: "advice.debt", piece: "advice", title: "Your debts", main: fh("narrative.debt_short_observations"), expert: [fh("narrative.debt_what_to_look_into"), fh("score.explainer", "Debt")], visual: debtVisual },
  { id: "advice.protection.emergency_fund", piece: "advice", title: "Your cash cushion", main: fh("narrative.protection_emergency_fund_short_observations"), expert: [fh("score.explainer", "Liquidity")], visual: emergencyVisual },
  { id: "advice.savings", piece: "advice", title: "What you save", main: fh("narrative.savings_short_observations"), expert: [fh("narrative.savings_what_to_look_into"), fh("score.explainer", "Cash flow")], visual: contributionsVisual },
  { id: "advice.retirement", piece: "advice", title: "Retirement", main: fh("narrative.retirement_short_observations"), expert: [fh("narrative.retirement_what_to_look_into")], visual: (r) => timeline(r, { onlyRetirement: true }) },
  { id: "advice.assets", piece: "advice", title: "What you own", main: fh("narrative.assets_short_observations"), expert: [fh("narrative.assets_what_to_look_into")], visual: otherAssetsVisual },
  { id: "advice.investments", piece: "advice", title: "Your investments", main: ia("narrative.summary_main"), expert: [ia("narrative.recommendations_main"), fh("score.explainer", "Investing")], visual: positionsVisual },
  { id: "advice.priorities", piece: "advice", title: "Where the spare money could go", main: fh("narrative.summary_recommendations"), expert: [fh("score.top_moves")], visual: none, budget: 200 },
];

export function findTopic(id: string): TopicDef | undefined {
  return TOPICS.find((t) => t.id === id);
}

export function topicInfo(t: TopicDef, raw: RawCase): TopicInfo {
  return {
    id: t.id,
    piece: t.piece,
    title: t.title,
    sources: [t.main, ...t.expert].map(srcPath),
    hasChart: t.visual(raw).chart !== null,
  };
}

export function rootOf(raw: RawCase, ref: TextRef): Json {
  return ref.file === "fh" ? raw.financialHealth : raw.investmentAnalysis;
}
