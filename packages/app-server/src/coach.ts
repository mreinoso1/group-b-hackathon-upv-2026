// The app server is an MCP client of plan-coach: it spawns the server over stdio, so the
// web app reaches the plan only through the same tools and resources any host would use.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRY = resolve(REPO_ROOT, "packages/plan-coach-mcp/src/stdio.ts");

export class CoachError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Coach {
  readJson<T = unknown>(uri: string): Promise<T>;
  call<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export async function connectCoach(): Promise<Coach> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", ENTRY],
    cwd: REPO_ROOT,
    // Only a minimal environment: plan-coach gets no keys it does not need.
    env: { ...getDefaultEnvironment(), CASES_DIR: process.env.CASES_DIR ?? "cases", DATA_DIR: process.env.DATA_DIR ?? "data" },
    stderr: "inherit",
  });
  const client = new Client({ name: "bite-app-server", version: "0.1.0" });
  console.log("connecting to plan-coach over stdio…");
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("plan-coach did not answer within 20 s")), 20_000);
    }),
  ]).finally(() => clearTimeout(timer));
  console.log(`plan-coach connected (pid ${transport.pid ?? "?"})`);

  return {
    async readJson<T>(uri: string) {
      const r = await client.readResource({ uri });
      const first = r.contents[0];
      if (!first || !("text" in first)) throw new CoachError("EMPTY_RESOURCE", `No content for ${uri}`);
      return JSON.parse(first.text) as T;
    },
    async call<T>(tool: string, args: Record<string, unknown>) {
      const r = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { type: string; text?: string }[] };
      const text = r.content.find((c) => c.type === "text")?.text ?? "{}";
      if (r.isError) {
        let error = { code: "TOOL_ERROR", message: text };
        try {
          error = JSON.parse(text).error ?? error;
        } catch {
          /* schema errors come back as plain text */
        }
        throw new CoachError(error.code, error.message);
      }
      return JSON.parse(text) as T;
    },
    close: () => client.close(),
  };
}
