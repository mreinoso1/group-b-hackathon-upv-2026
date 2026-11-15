import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type CaseSource, LocalCaseSource } from "@bite/plan-core";
import { createAiClient } from "./ai.ts";
import type { CoachDeps } from "./coach.ts";
import { JsonlAuditLog } from "./audit.ts";
import { FileBudget } from "./budget.ts";
import { DiskCache } from "./cache.ts";
import { config, REPO_ROOT } from "./config.ts";
import { createPlanCoachServer } from "./server.ts";
import { FallbackCaseSource, SherpasCaseSource } from "./sherpas.ts";
import { JsonlEventStore } from "./store.ts";

// Keys are read here, in plan-coach only: never by the web app, never logged.
const envFile = resolve(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const log = (msg: string) => console.error(`[plan-coach] ${msg}`);

/**
 * Cases come from the Sherpas MCP when MCP_URL and MCP_TOKEN are set, with cases/ as the
 * fallback (the token lasts 72 hours). CASES_SOURCE=local skips the MCP.
 */
function caseSource(): CaseSource {
  const local = new LocalCaseSource(config.casesDir);
  const url = process.env.MCP_URL;
  const token = process.env.MCP_TOKEN;
  if (process.env.CASES_SOURCE === "local" || !url || !token || token.includes("...")) {
    log("cases: cases/ folder");
    return local;
  }
  log(`cases: Sherpas MCP (${new URL(url).host}), falling back to cases/`);
  return new FallbackCaseSource(new SherpasCaseSource({ url, token }), local, log);
}

/** The model, cache and budget as the app uses them (also used by `npm run explanations`). */
export function createDefaultDeps(): CoachDeps {
  const key = process.env.TEAM_KEY;
  const baseUrl = process.env.LLM_PROXY_URL;
  const ai =
    key && baseUrl && !key.includes("...")
      ? createAiClient({
          baseUrl,
          key,
          textModel: process.env.TEXT_MODEL,
          reasoning: process.env.TEXT_REASONING,
          ttsModel: process.env.TTS_MODEL,
          voice: process.env.TTS_VOICE,
          voiceModel: process.env.VOICE_MODEL,
          realtimeVoice: process.env.VOICE_NAME,
        })
      : undefined;
  return {
    ai,
    cache: new DiskCache(config.cacheDir),
    budget: new FileBudget(join(config.dataDir, "budget.json"), {
      text: Number(process.env.TEXT_BUDGET_USD ?? 2),
      // The team shares $1.40 of ElevenLabs; stay under it by default.
      tts: Number(process.env.TTS_BUDGET_USD ?? 1),
      voice: Number(process.env.VOICE_BUDGET_USD ?? 3),
    }),
    textModel: process.env.TEXT_MODEL,
    ttsModel: process.env.TTS_MODEL,
    voice: process.env.TTS_VOICE,
    log,
  };
}

/** The server as the app runs it: cases from the Sherpas MCP or disk, events/audit/budget in data/, model output in cache/. */
export function createDefaultServer() {
  return createPlanCoachServer({
    ...createDefaultDeps(),
    source: caseSource(),
    store: new JsonlEventStore(join(config.dataDir, "events.jsonl")),
    audit: new JsonlAuditLog(join(config.dataDir, "audit.jsonl")),
  });
}

export const aiEnabled = () => Boolean(process.env.TEAM_KEY && process.env.LLM_PROXY_URL);
