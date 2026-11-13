import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Raw case files, as Sherpas serves them (MCP) or as they sit in cases/. */
export interface RawCase {
  id: string;
  financialHealth: Json;
  investmentAnalysis: Json | null;
  persona: string | null;
}

// The plan JSON is large and loosely typed; we read it through `at()` and check every value.
export type Json = unknown;

export interface CaseSource {
  readonly name: "local" | "sherpas";
  listIds(): Promise<string[]>;
  getCase(id: string): Promise<RawCase>;
}

export class UnknownCaseError extends Error {
  readonly code = "UNKNOWN_CASE";
  constructor(id: string) {
    super(`Unknown case: ${id}`);
  }
}

const SAFE_ID = /^[a-z0-9-]+$/;

/** Reads the four families from the repo's cases/ folder. Never expires. */
export class LocalCaseSource implements CaseSource {
  readonly name = "local" as const;
  private cache = new Map<string, RawCase>();

  constructor(private readonly dir: string) {}

  async listIds(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((id) => SAFE_ID.test(id) && existsSync(join(this.dir, id, "financial-health.json")))
      .sort();
  }

  async getCase(id: string): Promise<RawCase> {
    if (!SAFE_ID.test(id)) throw new UnknownCaseError(id);
    const hit = this.cache.get(id);
    if (hit) return hit;
    const folder = join(this.dir, id);
    const fhPath = join(folder, "financial-health.json");
    if (!existsSync(fhPath)) throw new UnknownCaseError(id);
    const read = (file: string) => {
      const p = join(folder, file);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    };
    const ia = read("investment-analysis.json");
    const raw: RawCase = {
      id,
      financialHealth: JSON.parse(readFileSync(fhPath, "utf8")),
      investmentAnalysis: ia ? JSON.parse(ia) : null,
      persona: read("persona.md"),
    };
    this.cache.set(id, raw);
    return raw;
  }
}

/**
 * Reads a dotted path such as "narrative.summary_main" or "profile.liabilities[0].balance".
 * Returns undefined when any step is missing.
 */
export function at(root: Json, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(".")) {
    const m = part.match(/^([^[\]]+)((?:\[\d+\])*)$/);
    if (!m) return undefined;
    cur = isRecord(cur) ? cur[m[1]!] : undefined;
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) {
      cur = Array.isArray(cur) ? cur[Number(idx[1])] : undefined;
    }
    if (cur === undefined || cur === null) return undefined;
  }
  return cur;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
