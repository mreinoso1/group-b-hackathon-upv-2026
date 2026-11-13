import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LocalCaseSource } from "@bite/plan-core";
import { createAiClient } from "./ai.ts";
import { JsonlAuditLog } from "./audit.ts";
import { FileBudget } from "./budget.ts";
import { DiskCache } from "./cache.ts";
import { config, REPO_ROOT } from "./config.ts";
import { createPlanCoachServer } from "./server.ts";
import { JsonlEventStore } from "./store.ts";

// Keys are read here, in plan-coach only: never by the web app, never logged.
const envFile = resolve(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const log = (msg: string) => console.error(`[plan-coach] ${msg}`);

/** The server as the app runs it: cases from disk, events/audit/budget in data/, model output in cache/. */
export function createDefaultServer() {
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
        })
      : undefined;
  return createPlanCoachServer({
    source: new LocalCaseSource(config.casesDir),
    store: new JsonlEventStore(join(config.dataDir, "events.jsonl")),
    audit: new JsonlAuditLog(join(config.dataDir, "audit.jsonl")),
    cache: new DiskCache(config.cacheDir),
    budget: new FileBudget(join(config.dataDir, "budget.json"), {
      text: Number(process.env.TEXT_BUDGET_USD ?? 2),
      // The team shares $1.40 of ElevenLabs; stay under it by default.
      tts: Number(process.env.TTS_BUDGET_USD ?? 1),
    }),
    ai,
    textModel: process.env.TEXT_MODEL,
    ttsModel: process.env.TTS_MODEL,
    voice: process.env.TTS_VOICE,
    log,
  });
}

export const aiEnabled = () => Boolean(process.env.TEAM_KEY && process.env.LLM_PROXY_URL);
