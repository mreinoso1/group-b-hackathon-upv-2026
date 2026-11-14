import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalCaseSource, TOPICS, type Capsule } from "@bite/plan-core";
import { MemoryAuditLog, redact } from "../src/audit.ts";
import { FileBudget } from "../src/budget.ts";
import { MemoryCache } from "../src/cache.ts";
import { createPlanCoachServer } from "../src/server.ts";
import { MemoryEventStore } from "../src/store.ts";

const CASES = fileURLToPath(new URL("../../../cases", import.meta.url));
const WEAH = "timothy-melanie-weah";

let client: Client;
let store: MemoryEventStore;
let audit: MemoryAuditLog;

beforeEach(async () => {
  store = new MemoryEventStore();
  audit = new MemoryAuditLog();
  const server = createPlanCoachServer({ source: new LocalCaseSource(CASES), store, audit, cache: new MemoryCache(), budget: new FileBudget(null, { text: 1, tts: 1 }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

const parse = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
const readJson = async (uri: string) => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text);
const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

describe("resources", () => {
  it("lists the four families", async () => {
    const data = await readJson("plan://cases");
    expect(data.dataSource).toBe("local");
    expect(data.cases.map((c: { id: string }) => c.id)).toContain(WEAH);
  });

  it("serves each plan piece for every case", async () => {
    const { resources } = await client.listResources();
    for (const kind of ["overview", "advice", "living-map", "topics", "persona"]) {
      expect(resources.some((r) => r.uri === `plan://${WEAH}/${kind}`)).toBe(true);
    }
    const advice = await readJson(`plan://${WEAH}/advice`);
    expect(advice.recommendations).toHaveLength(5);
    expect(advice.note).toMatch(/family decides/);
    const map = await readJson(`plan://${WEAH}/living-map`);
    expect(map.years.length).toBeGreaterThan(40);
    expect(map.milestones.some((m: { label: string }) => m.label === "Purchase a home")).toBe(true);
    const persona = await readJson(`plan://${WEAH}/persona`);
    expect(persona.audience).toBe("advisor-only");
  });
});

describe("get_capsule", () => {
  it("returns verbatim capsules for every case and topic", async () => {
    const cases = ["daniel-emily-johnson", "michael-carter", "samantha-lewis", WEAH];
    for (const caseId of cases) {
      for (const t of TOPICS) {
        const r = await call("get_capsule", { caseId, topicId: t.id });
        expect(r.isError).toBeFalsy();
        const c = parse(r) as Capsule;
        expect(c.level).toBe("standard");
        expect(c.generatedBy).toBe("verbatim");
        expect(c.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the plan's words beside a simpler explanation", async () => {
    const c = parse(await call("get_capsule", { caseId: WEAH, topicId: "advice.debt", level: "simple", member: "melanie" })) as Capsule;
    expect(c.planWords.length).toBeGreaterThan(0);
    expect(c.member).toBe("melanie");
  });

  it("explains errors instead of guessing", async () => {
    const unknownCase = await call("get_capsule", { caseId: "nobody", topicId: "advice.debt" });
    expect(unknownCase.isError).toBe(true);
    expect(parse(unknownCase).error.code).toBe("UNKNOWN_CASE");
    const unknownTopic = await call("get_capsule", { caseId: WEAH, topicId: "advice.crypto" });
    expect(parse(unknownTopic).error.code).toBe("UNKNOWN_TOPIC");
    const unknownMember = await call("get_capsule", { caseId: "michael-carter", topicId: "advice.debt", member: "melanie" });
    expect(parse(unknownMember).error.code).toBe("INVALID_MEMBER");
  });

  it("rejects malformed input at the schema", async () => {
    const r = await call("get_capsule", { caseId: "../etc", topicId: "advice.debt" });
    expect(r.isError).toBe(true);
  });
});

describe("record_reaction", () => {
  it.each([
    ["lost", { topicId: "advice.debt", level: "simple", attempt: 0 }],
    ["tell_me_more", { topicId: "advice.debt", level: "expert" }],
    ["got_it", { topicId: "advice.protection.emergency_fund", level: "standard" }],
  ])("%s decides what comes next", async (reaction, next) => {
    const r = parse(await call("record_reaction", { caseId: WEAH, member: "timothy", topicId: "advice.debt", level: "standard", reaction }));
    expect(r.next).toEqual(next);
    expect(store.list(WEAH)).toHaveLength(1);
    expect(store.list(WEAH)[0]).toMatchObject({ member: "timothy", reaction });
  });

  it("ends after the last topic", async () => {
    const last = TOPICS[TOPICS.length - 1]!.id;
    const r = parse(await call("record_reaction", { caseId: WEAH, member: "melanie", topicId: last, level: "standard", reaction: "got_it" }));
    expect(r.next).toBeNull();
  });

  it("refuses members who are not in the household", async () => {
    const r = await call("record_reaction", { caseId: WEAH, member: "liam", topicId: "advice.debt", level: "standard", reaction: "got_it" });
    expect(parse(r).error.code).toBe("INVALID_MEMBER");
    expect(store.list(WEAH)).toHaveLength(0);
  });
});

describe("calibration", () => {
  it("each new 'I'm lost' on the same idea asks for another way in", async () => {
    const lost = (level: string) =>
      call("record_reaction", { caseId: WEAH, member: "melanie", topicId: "advice.debt", level, reaction: "lost" }).then(parse);
    expect((await lost("standard")).next.attempt).toBe(0);
    expect((await lost("simple")).next.attempt).toBe(1);
    expect((await lost("simple")).next.attempt).toBe(2);
  });

  it("starts again with the first way in once they move on", async () => {
    const react = (reaction: string) =>
      call("record_reaction", { caseId: WEAH, member: "melanie", topicId: "advice.debt", level: "standard", reaction }).then(parse);
    await react("lost");
    await react("lost");
    await react("got_it");
    expect((await react("lost")).next.attempt).toBe(0);
  });

  it("without a key, the simple level is the plan's own words", async () => {
    const c = parse(await call("get_capsule", { caseId: WEAH, topicId: "advice.debt", level: "simple", member: "melanie", attempt: 1 })) as Capsule;
    expect(c.generatedBy).toBe("fallback");
    expect(c.style).toBe("steps");
  });

  it("without a key, audio is handed to the browser's voice", async () => {
    const r = parse(await call("get_audio", { caseId: WEAH, topicId: "advice.debt" }));
    expect(r.kind).toBe("browser");
    expect(r.text).toMatch(/^Your debts\./);
  });

  it("offers the explain prompts", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["explain_expert", "explain_simple"]);
    const simple = await client.getPrompt({ name: "explain_simple", arguments: { caseId: WEAH, topicId: "advice.debt", member: "timothy" } });
    const text = (simple.messages[0]!.content as { text: string }).text;
    expect(text).toContain("ALLOWED NUMBERS");
    expect(text).toContain("Timothy");
    const expert = await client.getPrompt({ name: "explain_expert", arguments: { caseId: WEAH, topicId: "advice.debt" } });
    expect((expert.messages[0]!.content as { text: string }).text).toContain("Debt management");
  });
});

describe("audit", () => {
  it("logs every tool and resource call", async () => {
    await call("get_capsule", { caseId: WEAH, topicId: "advice.debt" });
    await call("get_capsule", { caseId: "nobody", topicId: "advice.debt" });
    await client.readResource({ uri: "plan://cases" });
    expect(audit.entries.map((e) => [e.name, e.ok])).toEqual([
      ["get_capsule", true],
      ["get_capsule", false],
      ["plan://cases", true],
    ]);
  });

  it("never writes credentials", () => {
    const out = JSON.stringify(redact({ MCP_TOKEN: "abc", note: "key sk-abcdefghijk123 here", nested: { Authorization: "Bearer x" } }));
    expect(out).not.toContain("abc\"");
    expect(out).not.toContain("sk-abcdefghijk123");
    expect(out).not.toContain("Bearer x");
  });
});

describe("get_future_self", () => {
  it("returns one future self per adult, or just the member asked for", async () => {
    const both = parse(await call("get_future_self", { caseId: WEAH }));
    expect(both.futureSelves.map((f: { memberId: string }) => f.memberId)).toEqual(["timothy", "melanie"]);
    const melanie = parse(await call("get_future_self", { caseId: WEAH, member: "melanie" }));
    expect(melanie.futureSelves).toHaveLength(1);
    expect(melanie.futureSelves[0]).toMatchObject({ name: "Melanie", age: 60, reason: "retirement" });
    const together = parse(await call("get_future_self", { caseId: WEAH, member: "together" }));
    expect(together.futureSelves).toHaveLength(2);
  });

  it("refuses members who are not in the household", async () => {
    const r = await call("get_future_self", { caseId: "michael-carter", member: "melanie" });
    expect(parse(r).error.code).toBe("INVALID_MEMBER");
  });
});

describe("first step and check-ins", () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  it("standard capsules carry a line from the reader's future self", async () => {
    const c = parse(await call("get_capsule", { caseId: WEAH, topicId: "map.timeline", member: "melanie" })) as Capsule;
    expect(c.futureSelfLine).toMatch(/our road from 38 to 60/);
  });

  it("offers the plan's moves with the first one suggested", async () => {
    const r = parse(await call("get_first_step", { caseId: WEAH, member: "timothy" }));
    expect(r.suggested).toBe(0);
    expect(r.moves[0].title).toBe("Pay down revolving card");
    expect(r.commitment).toBeNull();
  });

  it("stores a commitment, then a check-in that leads back to the explanation", async () => {
    const c = parse(await call("commit_step", { caseId: WEAH, member: "timothy", moveIndex: 0, dueDate: inDays(5) }));
    expect(c.commitment).toMatchObject({ moveTitle: "Pay down revolving card" });
    const step = parse(await call("get_first_step", { caseId: WEAH, member: "timothy" }));
    expect(step.commitment.dueDate).toBe(inDays(5));
    const notYet = parse(await call("record_checkin", { caseId: WEAH, member: "timothy", status: "not_yet" }));
    expect(notYet.next).toEqual({ topicId: "advice.debt", level: "simple", attempt: 0 });
    const done = parse(await call("record_checkin", { caseId: WEAH, member: "timothy", status: "done" }));
    expect(done.next).toBeNull();
    expect(parse(await call("get_first_step", { caseId: WEAH, member: "timothy" })).checkins).toHaveLength(2);
  });

  it("rejects dates in the past or more than a year ahead, and check-ins without a commitment", async () => {
    expect(parse(await call("commit_step", { caseId: WEAH, member: "timothy", moveIndex: 0, dueDate: inDays(-2) })).error.code).toBe("INVALID_INPUT");
    expect(parse(await call("commit_step", { caseId: WEAH, member: "timothy", moveIndex: 0, dueDate: inDays(400) })).error.code).toBe("INVALID_INPUT");
    expect(parse(await call("record_checkin", { caseId: WEAH, member: "melanie", status: "done" })).error.code).toBe("INVALID_INPUT");
  });
});
