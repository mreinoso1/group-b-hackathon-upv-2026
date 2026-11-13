import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export const config = {
  casesDir: resolve(REPO_ROOT, process.env.CASES_DIR ?? "cases"),
  dataDir: resolve(REPO_ROOT, process.env.DATA_DIR ?? "data"),
  /** Model output (re-explanations, audio). Content-addressed; safe to commit for synthetic cases. */
  cacheDir: resolve(REPO_ROOT, process.env.CACHE_DIR ?? "cache"),
  httpPort: Number(process.env.PLAN_COACH_PORT ?? 8787),
};
