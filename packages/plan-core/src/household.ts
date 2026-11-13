import { arr, at, isRecord, num, str, type RawCase } from "./load.ts";
import type { CaseSummary, Child, Member, Milestone } from "./types.ts";

export function members(raw: RawCase): Member[] {
  const out: Member[] = [];
  for (const p of arr(at(raw.financialHealth, "case.household"))) {
    if (!isRecord(p)) continue;
    const role = p.role;
    const name = str(p.first_name);
    if ((role !== "client" && role !== "co-client") || !name) continue;
    out.push({
      id: name.toLowerCase(),
      name,
      role,
      age: num(p.age) ?? 0,
      retirementAge: num(p.retirement_age),
      riskProfile: str(p.risk_profile),
    });
  }
  return out;
}

export function children(raw: RawCase): Child[] {
  return arr(at(raw.financialHealth, "case.household"))
    .filter((p): p is Record<string, unknown> => isRecord(p) && p.role === "child")
    .map((p) => ({ name: str(p.first_name) ?? "Child", age: num(p.age) ?? 0 }));
}

export function caseSummary(raw: RawCase): CaseSummary {
  const fh = raw.financialHealth;
  const ms = members(raw);
  return {
    id: raw.id,
    label: ms.map((m) => m.name).join(" & ") || raw.id,
    city: str(at(fh, "case.city")) ?? "",
    state: str(at(fh, "case.state")) ?? "",
    score: num(at(fh, "score.published_score")) ?? 0,
    band: str(at(fh, "score.band")) ?? "",
    members: ms,
    children: children(raw),
  };
}

const DISTRESS = new Set(["BANKRUPTCY", "BANKRUPTCY_ZEROCASH"]);
const DISTRESS_LABEL: Record<string, string> = {
  BANKRUPTCY_ZEROCASH: "Savings projected to run out",
  BANKRUPTCY: "Plan projects all assets used up",
};

/** Life events from the living map (goals.chartGoals), in date order. */
export function milestones(raw: RawCase): Milestone[] {
  const out: Milestone[] = [];
  for (const g of arr(at(raw.financialHealth, "goals.chartGoals"))) {
    if (!isRecord(g)) continue;
    const date = str(g.date);
    const type = str(g.goalType);
    if (!date || !type) continue;
    out.push({
      date: date.slice(0, 10),
      year: Number(date.slice(0, 4)),
      type,
      subType: str(g.subType),
      label: str(g.name) ?? DISTRESS_LABEL[type] ?? type,
      distress: DISTRESS.has(type),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface PersonaProfile {
  /** The ```classification block of persona.md, e.g. { D4: "MISALIGNED", D5: "COLLABORATOR" }. */
  classification: Record<string, string>;
  /** Per member: stated risk profile from the household data. */
  memberRisk: Record<string, string | undefined>;
}

/** Persona is advisor material: used for tone and order, never shown to the family. */
export function personaProfile(raw: RawCase): PersonaProfile {
  const classification: Record<string, string> = {};
  const block = raw.persona?.match(/```classification\s*\n([\s\S]*?)```/);
  if (block) {
    for (const line of block[1]!.split("\n")) {
      const m = line.match(/^\s*(D\d[a-z]?)\s*:\s*(.+?)\s*$/);
      if (m) classification[m[1]!] = m[2]!;
    }
  }
  const memberRisk: Record<string, string | undefined> = {};
  for (const m of members(raw)) memberRisk[m.id] = m.riskProfile;
  return { classification, memberRisk };
}
