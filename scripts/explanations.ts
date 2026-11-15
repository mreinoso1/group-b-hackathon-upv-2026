// npm run explanations: makes sure every "I'm lost" explanation the app can ask for is in cache/,
// so the app works fully without TEAM_KEY (a judge running it from the README, or after the key expires).
//   npm run explanations            generate what is missing (needs TEAM_KEY), then report
//   npm run explanations -- --check report only; exits 1 if anything is missing
//   add --prune                     also delete cached explanations no current prompt uses
//   add --only <caseId>             one family
// Every explanation still goes through the number, people and length guards; one that fails them
// is not cached, and the app shows the plan's own words for it.
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { buildExplainPrompt, EXPLAIN_STYLES, LocalCaseSource, members, topicOrder } from "@bite/plan-core";
import { explainKey, simpleCapsule } from "../packages/plan-coach-mcp/src/coach.ts";
import { config } from "../packages/plan-coach-mcp/src/config.ts";
import { createDefaultDeps } from "../packages/plan-coach-mcp/src/factory.ts";

const check = process.argv.includes("--check");
const prune = process.argv.includes("--prune");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const deps = createDefaultDeps();
const source = new LocalCaseSource(config.casesDir);

interface Job {
  caseId: string;
  reader: string;
  topicId: string;
  attempt: number;
  key: string;
}

const jobs: Job[] = [];
for (const caseId of (await source.listIds()).filter((id) => !only || id === only)) {
  const raw = await source.getCase(caseId);
  const ms = members(raw);
  const readers = [...ms.map((m) => m.id), ...(ms.length > 1 ? ["together"] : [])];
  for (const reader of readers) {
    for (const topicId of topicOrder(raw, reader)) {
      for (let attempt = 0; attempt < EXPLAIN_STYLES.length; attempt++) {
        jobs.push({ caseId, reader, topicId, attempt, key: explainKey(buildExplainPrompt(raw, topicId, reader, attempt), deps) });
      }
    }
  }
}
const cached = (j: Job) => deps.cache.getJson("explain", j.key) !== undefined;

if (!check) {
  const missing = jobs.filter((j) => !cached(j));
  if (missing.length && !deps.ai) {
    console.log(`${missing.length} explanation(s) missing and no TEAM_KEY in .env: run with a key, or use --check.`);
  } else if (missing.length) {
    console.log(`Generating ${missing.length} explanation(s)…`);
    let done = 0;
    // The AI client already holds calls to 3 at once and 50 a minute.
    await Promise.all(
      missing.map(async (j) => {
        await simpleCapsule(await source.getCase(j.caseId), j.topicId, j.reader, j.attempt, deps);
        done++;
        if (done % 20 === 0 || done === missing.length) console.log(`  ${done}/${missing.length}`);
      }),
    );
  }
}

const byReader = new Map<string, { have: number; total: number }>();
for (const j of jobs) {
  const k = `${j.caseId} · ${j.reader}`;
  const r = byReader.get(k) ?? { have: 0, total: 0 };
  r.total++;
  if (cached(j)) r.have++;
  byReader.set(k, r);
}
for (const [k, r] of byReader) console.log(`${r.have === r.total ? "✓" : "✗"} ${k}: ${r.have}/${r.total}`);

if (prune && !only) {
  const wanted = new Set(jobs.map((j) => `${j.key}.json`));
  const dir = resolve(config.cacheDir, "explain");
  const stale = readdirSync(dir).filter((f) => f.endsWith(".json") && !wanted.has(f));
  for (const f of stale) rmSync(resolve(dir, f));
  console.log(`Pruned ${stale.length} explanation(s) no current prompt uses.`);
}

const missingNow = jobs.filter((j) => !cached(j)).length;
console.log(
  missingNow
    ? `${missingNow} of ${jobs.length} missing (failed the guards, or no key): the app shows the plan's own words for those.`
    : `All ${jobs.length} explanations cached: "I'm lost" works without a key.`,
);
console.log(`Text spend so far: $${deps.budget.report().text.spent.toFixed(3)}`);
if (check && missingNow) process.exitCode = 1;
