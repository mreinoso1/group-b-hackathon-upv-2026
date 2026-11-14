// plan-coach: our own MCP server. It reads the family's plan (from Sherpas or cases/),
// doses it into capsules and records how each person reacts. The web app, the voice agent,
// couple mode and the advisor brief all go through this server.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  at,
  buildCapsule,
  buildExplainPrompt,
  futureSelves,
  caseSummary,
  LEVELS,
  members,
  milestones,
  nextTopic,
  personaProfile,
  planBlocks,
  REACTIONS,
  TOPICS,
  topicInfo,
  UnknownCaseError,
  UnknownTopicError,
  type CaseSource,
  type Level,
  type RawCase,
} from "@bite/plan-core";
import { audited, type AuditLog } from "./audit.ts";
import { capsuleAudio, simpleCapsule, type CoachDeps } from "./coach.ts";
import type { EventStore } from "./store.ts";

export interface PlanCoachDeps extends CoachDeps {
  source: CaseSource;
  store: EventStore;
  audit: AuditLog;
}

export const RESOURCE_KINDS = ["overview", "advice", "living-map", "topics", "persona"] as const;
type ResourceKind = (typeof RESOURCE_KINDS)[number];

class InvalidMemberError extends Error {
  readonly code = "INVALID_MEMBER";
}

const CASE_ID = z.string().regex(/^[a-z0-9-]+$/).describe("Case id from plan://cases, e.g. timothy-melanie-weah");
const TOPIC_ID = z.string().describe("Topic id from plan://{caseId}/topics, e.g. advice.debt");
const LEVEL = z.enum(LEVELS as [Level, ...Level[]]);
const MEMBER = z.string().regex(/^[a-z]+$/).describe("Household member id (first name, lower case), or 'together'");
const ATTEMPT = z
  .number()
  .int()
  .min(0)
  .max(5)
  .describe("How many times this person already said \"I'm lost\" on this idea; each attempt tries another way in");

export function createPlanCoachServer(deps: PlanCoachDeps): McpServer {
  const server = new McpServer(
    { name: "plan-coach", version: "0.1.0" },
    {
      instructions:
        "Doses a family's Sherpas plan into short capsules. Never invent figures: every number comes from the plan, " +
        "and when data is missing the result says so in `missing`. The order of competing priorities is the family's call.",
    },
  );
  const { source, store, audit } = deps;
  const coach: CoachDeps = deps;

  // ---- Resources: the plan's three pieces, plus the capsule catalog -------------------

  server.registerResource(
    "cases",
    "plan://cases",
    { title: "Families", description: "The households available, with score and members", mimeType: "application/json" },
    audited(audit, "resource", "plan://cases", async (uri: URL) => {
      const ids = await source.listIds();
      const cases = await Promise.all(ids.map(async (id) => caseSummary(await source.getCase(id))));
      return json(uri.href, { dataSource: source.name, cases });
    }),
  );

  server.registerResource(
    "case-section",
    new ResourceTemplate("plan://{caseId}/{kind}", {
      list: async () => {
        const ids = await source.listIds();
        return {
          resources: ids.flatMap((id) =>
            RESOURCE_KINDS.map((kind) => ({ uri: `plan://${id}/${kind}`, name: `${id} ${kind}`, mimeType: "application/json" })),
          ),
        };
      },
    }),
    {
      title: "Plan section",
      description:
        "One piece of a family's plan: overview, advice, living-map, topics (capsule catalog) or persona (advisor-only: tone and order, never shown to the family)",
      mimeType: "application/json",
    },
    audited(audit, "resource", "plan://{caseId}/{kind}", async (uri: URL, vars: Record<string, string | string[]>) => {
      const caseId = String(vars.caseId);
      const kind = String(vars.kind) as ResourceKind;
      if (!RESOURCE_KINDS.includes(kind)) throw new Error(`Unknown section "${kind}". Use one of ${RESOURCE_KINDS.join(", ")}`);
      const raw = await source.getCase(caseId);
      return json(uri.href, section(raw, kind));
    }),
  );

  // ---- Tools ---------------------------------------------------------------------------

  server.registerTool(
    "get_capsule",
    {
      title: "Get a capsule",
      description:
        "One idea of the plan in 30–60 seconds: text, chart spec and key figures. level=standard is the plan's own words; " +
        "expert adds the rest of that section and every figure with its JSON source; simple re-explains (the plan's words stay in planWords).",
      inputSchema: { caseId: CASE_ID, topicId: TOPIC_ID, level: LEVEL.default("standard"), member: MEMBER.optional(), attempt: ATTEMPT.default(0) },
      annotations: { readOnlyHint: true },
    },
    audited(audit, "tool", "get_capsule", async (args: { caseId: string; topicId: string; level: Level; member?: string; attempt?: number }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
        if (args.level === "simple") return simpleCapsule(raw, args.topicId, args.member ?? null, args.attempt ?? 0, coach);
        return buildCapsule(raw, { topicId: args.topicId, level: args.level, member: args.member ?? null });
      }),
    ),
  );

  server.registerTool(
    "record_reaction",
    {
      title: "Record a reaction",
      description:
        "Stores how a member reacted to a capsule (got_it, lost, tell_me_more) and returns what to show next: " +
        "lost → same topic, simple; tell_me_more → same topic, expert; got_it → next topic.",
      inputSchema: {
        caseId: CASE_ID,
        member: MEMBER,
        topicId: TOPIC_ID,
        level: LEVEL,
        reaction: z.enum(REACTIONS as [string, ...string[]]),
        dwellMs: z.number().int().min(0).max(3_600_000).optional(),
      },
    },
    audited(
      audit,
      "tool",
      "record_reaction",
      async (args: { caseId: string; member: string; topicId: string; level: Level; reaction: string; dwellMs?: number }) =>
        guard(async () => {
          const raw = await source.getCase(args.caseId);
          checkMember(raw, args.member);
          if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
          const reaction = args.reaction as (typeof REACTIONS)[number];
          store.append({
            type: "reaction",
            at: new Date().toISOString(),
            caseId: args.caseId,
            member: args.member,
            topicId: args.topicId,
            level: args.level,
            reaction,
            dwellMs: args.dwellMs,
          });
          // Each "I'm lost" in a row on the same idea asks for a different way in; any other
          // reaction ends the streak, so coming back later starts again with the analogy.
          const mine = store.list(args.caseId).filter((e) => e.type === "reaction" && e.member === args.member && e.topicId === args.topicId);
          let lostSoFar = 0;
          for (let i = mine.length - 1; i >= 0 && mine[i]!.reaction === "lost"; i--) lostSoFar++;
          const next =
            reaction === "lost"
              ? { topicId: args.topicId, level: "simple" as const, attempt: Math.min(5, Math.max(0, lostSoFar - 1)) }
              : reaction === "tell_me_more"
                ? { topicId: args.topicId, level: "expert" as const }
                : nextOrNull(args.topicId);
          return { ok: true, next };
        }),
    ),
  );

  server.registerTool(
    "get_future_self",
    {
      title: "Get the future self",
      description:
        "Who speaks to each adult as their future self: the age and year they speak from (retirement, or the last year " +
        "with savings if the plan says they run out), an opening line built only from plan values, and upcoming plan " +
        "dates to check in. With member, only that person's; with 'together' or no member, everyone's.",
      inputSchema: { caseId: CASE_ID, member: MEMBER.optional() },
      annotations: { readOnlyHint: true },
    },
    audited(audit, "tool", "get_future_self", async (args: { caseId: string; member?: string }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        const all = futureSelves(raw);
        const one = args.member && args.member !== "together";
        return { futureSelves: one ? all.filter((f) => f.memberId === args.member) : all };
      }),
    ),
  );

  server.registerTool(
    "get_audio",
    {
      title: "Get a capsule's audio",
      description:
        "Audio for a capsule, generated once and cached. Returns { kind: 'audio', audioId } (an mp3 in the cache) or, with no key " +
        "or when the voice budget is used up, { kind: 'browser', text } so the client reads it with the device's own voice.",
      inputSchema: { caseId: CASE_ID, topicId: TOPIC_ID, level: LEVEL.default("standard"), member: MEMBER.optional(), attempt: ATTEMPT.default(0) },
    },
    audited(audit, "tool", "get_audio", async (args: { caseId: string; topicId: string; level: Level; member?: string; attempt?: number }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
        const capsule =
          args.level === "simple"
            ? await simpleCapsule(raw, args.topicId, args.member ?? null, args.attempt ?? 0, coach)
            : buildCapsule(raw, { topicId: args.topicId, level: args.level, member: args.member ?? null });
        return capsuleAudio(capsule, coach);
      }),
    ),
  );

  // ---- Prompts: launched by the person ("I'm lost", "Tell me more") -------------------

  server.registerPrompt(
    "explain_simple",
    {
      title: "Explain it another way",
      description: "Re-explains one idea of the plan for a person who is lost, in their tone, using only the numbers in that part of the plan.",
      argsSchema: {
        caseId: z.string().describe("Case id"),
        topicId: z.string().describe("Topic id"),
        member: z.string().optional().describe("Member id or 'together'"),
        attempt: z.string().optional().describe("0 analogy, 1 steps, 2 one number"),
      },
    },
    audited(audit, "prompt", "explain_simple", async (args: { caseId: string; topicId: string; member?: string; attempt?: string }) => {
      const raw = await source.getCase(args.caseId);
      checkMember(raw, args.member);
      if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
      const p = buildExplainPrompt(raw, args.topicId, args.member ?? null, Number(args.attempt ?? 0) || 0);
      // MCP prompt messages are user/assistant only: the instructions travel as the first user turn.
      const [system, ...rest] = p.messages;
      return {
        description: `Explain "${args.topicId}" for ${p.audience} (${p.style})`,
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: `${system!.content}\n\n${rest.map((m) => m.content).join("\n\n")}` } },
        ],
      };
    }),
  );

  server.registerPrompt(
    "explain_expert",
    {
      title: "Tell me more",
      description: "Sets up follow-up questions on one idea with the full plan text and every figure with where it sits in the plan. Answers stay inside the plan.",
      argsSchema: { caseId: z.string().describe("Case id"), topicId: z.string().describe("Topic id") },
    },
    audited(audit, "prompt", "explain_expert", async (args: { caseId: string; topicId: string }) => {
      const raw = await source.getCase(args.caseId);
      if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
      const std = buildCapsule(raw, { topicId: args.topicId, level: "standard" });
      const exp = buildCapsule(raw, { topicId: args.topicId, level: "expert" });
      const text = [
        `You answer detailed questions about "${std.title}" in this family's financial plan.`,
        "Use only the plan text and figures below. Quote figures exactly; if something is not here, say it is not in the plan and suggest asking their advisor.",
        "Do not rank their priorities: the order is the family's decision.",
        "",
        "PLAN TEXT:",
        ...[...std.blocks, ...exp.blocks].map((b) => `- ${b.text}`),
        "",
        "FIGURES (label: value [where in the plan]):",
        ...exp.figures.map((f) => `- ${f.label}: ${f.value}${f.unit === "USD" ? " USD" : f.unit === "%" ? "%" : ` ${f.unit}`} [${f.section ?? f.source}]`),
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }),
  );

  return server;
}

// ---- helpers ---------------------------------------------------------------------------

function nextOrNull(topicId: string) {
  const id = nextTopic(topicId);
  return id ? { topicId: id, level: "standard" as const } : null;
}

function checkMember(raw: RawCase, member: string | undefined) {
  if (!member || member === "together") return;
  const ids = members(raw).map((m) => m.id);
  if (!ids.includes(member)) throw new InvalidMemberError(`Unknown member "${member}" for ${raw.id}. Members: ${ids.join(", ")}, or together`);
}

function section(raw: RawCase, kind: ResourceKind): unknown {
  const fh = raw.financialHealth;
  switch (kind) {
    case "overview":
      return {
        household: caseSummary(raw),
        score: at(fh, "score"),
        summary: planBlocks(raw, { file: "fh", path: "narrative.summary_main" }),
        goals: planBlocks(raw, { file: "fh", path: "goals.goalsSummary" }),
      };
    case "advice":
      return {
        note: "The plan lists these in its own order. They can compete for the same money; the family decides the order.",
        recommendations: planBlocks(raw, { file: "fh", path: "narrative.summary_recommendations" }),
        topMoves: at(fh, "score.top_moves") ?? [],
        combinedMoves: at(fh, "score.combined_moves") ?? [],
        investmentRecommendations: planBlocks(raw, { file: "ia", path: "narrative.recommendations_main" }),
      };
    case "living-map":
      return { years: at(fh, "projections.yearly") ?? [], milestones: milestones(raw) };
    case "topics":
      return { topics: TOPICS.map((t) => topicInfo(t, raw)) };
    case "persona":
      return { audience: "advisor-only", ...personaProfile(raw) };
  }
}

function json(uri: string, data: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] };
}

/** Turns results into MCP tool results, and known errors into readable `isError` results. */
async function guard(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err instanceof UnknownCaseError || err instanceof UnknownTopicError || err instanceof InvalidMemberError) {
      const error = { code: err.code, message: err.message };
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error }) }] };
    }
    throw e;
  }
}
