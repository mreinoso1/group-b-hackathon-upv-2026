// Shared types for the whole app. Every figure carries the JSON path it came from,
// so nothing on screen is a number we made up.

export type Piece = "overview" | "advice" | "living_map";
export type Level = "standard" | "simple" | "expert";
export type Reaction = "got_it" | "lost" | "tell_me_more";

export const LEVELS: readonly Level[] = ["standard", "simple", "expert"];
export const REACTIONS: readonly Reaction[] = ["got_it", "lost", "tell_me_more"];

export type Unit = "USD" | "%" | "years" | "months" | "score";

export interface Figure {
  label: string;
  value: number;
  unit: Unit;
  /** Dotted JSON path inside the case, e.g. "financial-health:profile.liabilities[0].balance". For tools and audits. */
  source: string;
  /** Where a person finds it in their Sherpas plan, e.g. "Insurance & Protection · Emergency fund". For people. */
  section?: string;
}

export interface Member {
  id: string; // first name, lower case
  name: string;
  role: "client" | "co-client";
  age: number;
  retirementAge?: number;
  riskProfile?: string;
}

export interface Child {
  name: string;
  age: number;
}

export interface CaseSummary {
  id: string;
  label: string;
  city: string;
  state: string;
  score: number;
  band: string;
  members: Member[];
  children: Child[];
}

export interface Milestone {
  date: string; // ISO date
  year: number;
  type: string;
  /** e.g. REAL_ESTATE_PURCHASE or VEHICLE_PURCHASE for PURCHASE goals. */
  subType?: string;
  label: string;
  /** True for plan events such as savings running out: handle with care, never alarmist. */
  distress: boolean;
}

export type ChartSpec =
  | {
      kind: "score";
      score: number;
      band: string;
      /** The plan's own band colour (score.colour), e.g. "yellow". */
      colour?: string;
      pillars: { label: string; score: number }[];
      source: string;
    }
  | {
      kind: "bars";
      title: string;
      unit: "USD";
      bars: { label: string; value: number; note?: string; highlight?: boolean }[];
      source: string;
    }
  | {
      kind: "range";
      title: string;
      value: number;
      valueLabel: string;
      min: number;
      max: number;
      rangeLabel: string;
      source: string;
    }
  | {
      kind: "have-need";
      title: string;
      rows: { label: string; have: number; need: number; needLabel: string }[];
      source: string;
    }
  | {
      kind: "timeline";
      title: string;
      seriesLabel: string;
      points: { year: number; value: number; age?: number }[];
      milestones: Milestone[];
      source: string;
    };

export interface Block {
  text: string;
  source: string;
}

export interface TopicInfo {
  id: string;
  piece: Piece;
  title: string;
  sources: string[];
  hasChart: boolean;
}

export interface Capsule {
  id: string;
  caseId: string;
  topicId: string;
  piece: Piece;
  level: Level;
  member: string | null;
  title: string;
  /** Sentences straight from the plan (standard/expert) or a labelled fallback (simple, until the LLM step). */
  blocks: Block[];
  /** For the simple level: the plan's own words, always shown next to the re-explanation. */
  planWords: Block[];
  chart: ChartSpec | null;
  figures: Figure[];
  estSeconds: number;
  generatedBy: "verbatim" | "fallback" | "llm";
  /** For a simple capsule: which way in was tried (analogy, steps, one_number). */
  style?: string;
  /** A first-person line from the reader's future self, shown before the capsule. */
  futureSelfLine?: string;
  /** For a model-written capsule: how many numbers were checked against the plan. All passed, or it would not be here. */
  check?: { numbersChecked: number };
  /** JSON paths we looked for and did not find. The UI says so instead of guessing. */
  missing: string[];
  reactions: Reaction[];
}
