import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LocalCaseSource, UnknownCaseError } from "@bite/plan-core";
import { MemoryAuditLog } from "../src/audit.ts";
import { FileBudget } from "../src/budget.ts";
import { MemoryCache } from "../src/cache.ts";
import { createPlanCoachServer } from "../src/server.ts";
import { FallbackCaseSource, SherpasCaseSource } from "../src/sherpas.ts";
import { MemoryEventStore } from "../src/store.ts";

const CASES = fileURLToPath(new URL("../../../cases", import.meta.url));
const FILES: Record<string, string> = { "financial-health": "financial-health.json", "investment-analysis": "investment-analysis.json", persona: "persona.md" };
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

/** A stand-in for the Sherpas MCP: the same two tools, answering from cases/ the way the real one does. */
function fakeSherpas(calls: string[]) {
  const ids = readdirSync(CASES).filter((id) => existsSync(join(CASES, id, "financial-health.json")));
  const server = new McpServer({ name: "sherpas-cases", version: "0.0.0" });
  server.registerTool("list_cases", { description: "List the cases" }, async () => {
    calls.push("list_cases");
    return text(JSON.stringify(ids.map((id) => ({ id }))));
  });
  server.registerTool("get_case", { description: "Read one case", inputSchema: { caseId: z.string(), part: z.string().optional() } }, async ({ caseId, part }) => {
    calls.push(`get_case ${caseId} ${part}`);
    if (!ids.includes(caseId)) return text(`No case "${caseId}". Valid ids: ${ids.join(", ")}.`, true);
    const file = join(CASES, caseId, FILES[part ?? ""] ?? "missing");
    // The MCP serves Markdown with LF line endings.
    return existsSync(file) ? text(readFileSync(file, "utf8").replace(/\r\n/g, "\n")) : text(`No part "${part}"`, true);
  });
  return server;
}

function sherpasSource(calls: string[] = []) {
  return new SherpasCaseSource({
    url: "http://sherpas.test/mcp",
    token: "test-token",
    transport: () => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      void fakeSherpas(calls).connect(a);
      return b;
    },
  });
}

/** A Sherpas source whose token is refused, like an expired one. */
const refused = () =>
  new SherpasCaseSource({
    url: "http://sherpas.test/mcp",
    token: "expired",
    transport: () => {
      throw new Error('Streamable HTTP error: {"error":"invalid_token","error_description":"Invalid or expired token"}');
    },
  });

describe("SherpasCaseSource", () => {
  it("returns exactly the plan in cases/ for every family", async () => {
    const sherpas = sherpasSource();
    const local = new LocalCaseSource(CASES);
    expect(await sherpas.listIds()).toEqual(await local.listIds());
    for (const id of await local.listIds()) {
      const [a, b] = await Promise.all([sherpas.getCase(id), local.getCase(id)]);
      expect(a.financialHealth).toEqual(b.financialHealth);
      expect(a.investmentAnalysis).toEqual(b.investmentAnalysis);
      expect(a.persona).toBe(b.persona?.replace(/\r\n/g, "\n"));
    }
  });

  it("fetches each part once", async () => {
    const calls: string[] = [];
    const sherpas = sherpasSource(calls);
    await Promise.all([sherpas.getCase("michael-carter"), sherpas.getCase("michael-carter")]);
    await sherpas.getCase("michael-carter");
    expect(calls.filter((c) => c === "list_cases")).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("get_case michael-carter"))).toHaveLength(3);
  });

  it("rejects ids that are not in list_cases without asking for them", async () => {
    const calls: string[] = [];
    const sherpas = sherpasSource(calls);
    await expect(sherpas.getCase("nobody")).rejects.toBeInstanceOf(UnknownCaseError);
    await expect(sherpas.getCase("../etc")).rejects.toBeInstanceOf(UnknownCaseError);
    expect(calls.some((c) => c.startsWith("get_case"))).toBe(false);
  });

  it("retries after a failure instead of caching it", async () => {
    let fail = true;
    const source = new SherpasCaseSource({
      url: "http://sherpas.test/mcp",
      token: "t",
      transport: () => {
        if (fail) throw new Error("network down");
        const [a, b] = InMemoryTransport.createLinkedPair();
        void fakeSherpas([]).connect(a);
        return b;
      },
    });
    await expect(source.listIds()).rejects.toThrow("network down");
    fail = false;
    expect(await source.listIds()).toContain("timothy-melanie-weah");
  });
});

describe("FallbackCaseSource", () => {
  it("serves the Sherpas MCP when it answers", async () => {
    const source = new FallbackCaseSource(sherpasSource(), new LocalCaseSource(CASES));
    expect((await source.getCase("samantha-lewis")).id).toBe("samantha-lewis");
    expect(source.name).toBe("sherpas");
  });

  it("falls back to cases/ when the token is refused, says so, and tries again later", async () => {
    const logs: string[] = [];
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const source = new FallbackCaseSource(refused(), new LocalCaseSource(CASES), (m) => logs.push(m), 60_000);
      expect((await source.getCase("timothy-melanie-weah")).id).toBe("timothy-melanie-weah");
      expect(source.name).toBe("local");
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/expired token.*using local for 60 s/);
      await source.listIds(); // within the minute: straight to cases/, no new attempt or log
      expect(logs).toHaveLength(1);
      now = 61_000;
      await source.listIds();
      expect(logs).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });

  it("keeps an unknown case an error instead of hiding it behind the fallback", async () => {
    const source = new FallbackCaseSource(sherpasSource(), new LocalCaseSource(CASES));
    await expect(source.getCase("nobody")).rejects.toBeInstanceOf(UnknownCaseError);
    expect(source.name).toBe("sherpas");
  });
});

describe("plan-coach on the Sherpas MCP", () => {
  it("builds capsules from the Sherpas data and reports where it came from", async () => {
    const source = new FallbackCaseSource(sherpasSource(), new LocalCaseSource(CASES));
    const server = createPlanCoachServer({ source, store: new MemoryEventStore(), audit: new MemoryAuditLog(), cache: new MemoryCache(), budget: new FileBudget(null, { text: 1, tts: 1, voice: 1 }) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const cases = JSON.parse(((await client.readResource({ uri: "plan://cases" })).contents[0] as { text: string }).text);
    expect(cases.dataSource).toBe("sherpas");
    expect(cases.cases).toHaveLength(4);
    const r = await client.callTool({ name: "get_capsule", arguments: { caseId: "timothy-melanie-weah", topicId: "overview.score" } });
    expect(r.isError).toBeFalsy();
    const capsule = JSON.parse((r.content as { text: string }[])[0]!.text);
    expect(capsule.blocks.length).toBeGreaterThan(0);
  });
});
