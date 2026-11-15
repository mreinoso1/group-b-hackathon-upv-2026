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
  checkInLabel,
  futureSelf,
  futureSelfLine,
  futureSelves,
  agreement,
  planPriorities,
  suggestPriority,
  caseSummary,
  LEVELS,
  members,
  milestones,
  nextTopicFor,
  topicOrder,
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
import { capsuleAudio, simpleCapsule, speak, type CoachDeps } from "./coach.ts";
import { isCheckin, isCommitment, isRanking, isReaction, type EventStore } from "./store.ts";

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

class InvalidInputError extends Error {
  readonly code = "INVALID_INPUT";
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

  server.registerResource(
    "member-topics",
    new ResourceTemplate("plan://{caseId}/topics/{member}", { list: undefined }),
    {
      title: "Capsules in this person's order",
      description: "The capsule catalog in the order that fits one reader (their risk profile and future self), or the plan's order for 'together'.",
      mimeType: "application/json",
    },
    audited(audit, "resource", "plan://{caseId}/topics/{member}", async (uri: URL, vars: Record<string, string | string[]>) => {
      const raw = await source.getCase(String(vars.caseId));
      const member = String(vars.member);
      checkMember(raw, member);
      const byId = new Map(TOPICS.map((t) => [t.id, t]));
      return json(uri.href, { topics: topicOrder(raw, member).map((id) => topicInfo(byId.get(id)!, raw)) });
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
        const capsule = buildCapsule(raw, { topicId: args.topicId, level: args.level, member: args.member ?? null });
        // The reader's future self introduces each idea (together: the first adult's).
        // The reader's future self introduces each idea; reading together, the partners take turns.
        const selves = futureSelves(raw);
        const turn = topicOrder(raw).indexOf(args.topicId);
        const speaker =
          args.member && args.member !== "together" ? futureSelf(raw, args.member) : selves[Math.max(0, turn) % Math.max(1, selves.length)];
        return args.level === "standard" && speaker
          ? { ...capsule, futureSelfLine: futureSelfLine(speaker, args.topicId, topicOrder(raw, args.member)[0] === args.topicId), futureSelfName: speaker.name }
          : capsule;
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
          // reaction ends the streak, so coming back later starts again with plain words.
          const mine = store.list(args.caseId).filter(isReaction).filter((e) => e.member === args.member && e.topicId === args.topicId);
          let lostSoFar = 0;
          for (let i = mine.length - 1; i >= 0 && mine[i]!.reaction === "lost"; i--) lostSoFar++;
          const next =
            reaction === "lost"
              ? { topicId: args.topicId, level: "simple" as const, attempt: Math.min(5, Math.max(0, lostSoFar - 1)) }
              : reaction === "tell_me_more"
                ? { topicId: args.topicId, level: "expert" as const }
                : nextOrNull(raw, args.member, args.topicId);
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
        const all = futureSelves(raw).map((f) => ({ ...f, checkIns: f.checkIns.map((m) => ({ ...m, checkInLabel: checkInLabel(m) })) }));
        const one = args.member && args.member !== "together";
        return { futureSelves: one ? all.filter((f) => f.memberId === args.member) : all };
      }),
    ),
  );

  // ---- First step, couple agreement, check-ins, questions ------------------------------

  /** Latest order per partner. */
  const rankingsOf = (caseId: string) => {
    const orders: Record<string, number[]> = {};
    for (const e of store.list(caseId).filter(isRanking)) orders[e.member] = e.order;
    return orders;
  };
  const agreementFor = (raw: RawCase) =>
    agreement(
      planPriorities(raw),
      members(raw).map((m) => ({ id: m.id, name: m.name })),
      rankingsOf(raw.id),
    );

  server.registerTool(
    "get_first_step",
    {
      title: "Get the first step",
      description:
        "The plan's priorities (narrative.summary_recommendations, in the plan's order): a plain label, the plan's own sentence, " +
        "the capsule that explains it and, where the plan scores a matching move, the score before → after and the best " +
        "combination. `suggested` follows the plan's order; for a couple reading together who both ranked, " +
        "the one they put highest together. Plus the member's commitment and check-ins.",
      inputSchema: { caseId: CASE_ID, member: MEMBER.optional() },
      annotations: { readOnlyHint: true },
    },
    audited(audit, "tool", "get_first_step", async (args: { caseId: string; member?: string }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        const events = store.list(args.caseId).filter((e) => !args.member || e.member === args.member);
        const priorities = planPriorities(raw);
        const together = !args.member || args.member === "together";
        const agreed = together ? agreementFor(raw) : null;
        const suggestion =
          agreed?.status === "ready" && agreed.sharedFirst !== null
            ? { index: agreed.sharedFirst, because: "agreement" as const }
            : suggestPriority(priorities);
        return {
          priorities,
          suggested: suggestion.index,
          suggestedBecause: suggestion.because,
          commitment: events.filter(isCommitment).at(-1) ?? null,
          checkins: events.filter(isCheckin),
        };
      }),
    ),
  );

  server.registerTool(
    "submit_ranking",
    {
      title: "Order the priorities",
      description: "Stores one partner's order of the plan's priorities (indexes from get_first_step, first to last). Returns who still has to order.",
      inputSchema: { caseId: CASE_ID, member: MEMBER, order: z.array(z.number().int().min(0).max(20)).min(1).max(20) },
    },
    audited(audit, "tool", "submit_ranking", async (args: { caseId: string; member: string; order: number[] }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        if (args.member === "together") throw new InvalidInputError("Each partner orders the priorities on their own");
        const indexes = planPriorities(raw).map((p) => p.index);
        const full = args.order.length === indexes.length && indexes.every((i) => args.order.includes(i));
        if (!full) throw new InvalidInputError("Order every priority once");
        store.append({ type: "ranking", at: new Date().toISOString(), caseId: args.caseId, member: args.member, order: args.order });
        return { ok: true, waitingFor: agreementFor(raw).waitingFor };
      }),
    ),
  );

  server.registerTool(
    "get_agreement",
    {
      title: "Get the agreement point",
      description:
        "Where the partners agree and differ on the plan's priorities: each item with every partner's position, the one they put " +
        "highest together, those both put in their top two and those three or more places apart, with a plain summary. It never " +
        "ranks for them. status is waiting (with waitingFor), ready, or single_member.",
      inputSchema: { caseId: CASE_ID },
      annotations: { readOnlyHint: true },
    },
    audited(audit, "tool", "get_agreement", async (args: { caseId: string }) =>
      guard(async () => agreementFor(await source.getCase(args.caseId))),
    ),
  );

  server.registerTool(
    "commit_step",
    {
      title: "Commit to a step",
      description:
        "Stores \"I'll do it by <date>\": one of the plan's priorities, for a member or the couple (together), from today up to a year ahead.",
      inputSchema: {
        caseId: CASE_ID,
        member: MEMBER,
        priorityIndex: z.number().int().min(0).max(20),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
      },
    },
    audited(audit, "tool", "commit_step", async (args: { caseId: string; member: string; priorityIndex: number; dueDate: string }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        const priority = planPriorities(raw).find((p) => p.index === args.priorityIndex);
        if (!priority) throw new InvalidInputError(`No priority ${args.priorityIndex} in this plan`);
        const today = new Date().toISOString().slice(0, 10);
        const limit = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
        if (args.dueDate < today || args.dueDate > limit) throw new InvalidInputError("Pick a date between today and one year from now");
        const commitment = {
          type: "commitment" as const,
          at: new Date().toISOString(),
          caseId: args.caseId,
          member: args.member,
          priorityIndex: priority.index,
          label: priority.label,
          dueDate: args.dueDate,
        };
        store.append(commitment);
        return { ok: true, commitment };
      }),
    ),
  );

  server.registerTool(
    "record_checkin",
    {
      title: "Record a check-in answer",
      description:
        "The answer when the future self asks \"Did you do it?\". not_yet returns the capsule that explains the step, at the simple level.",
      inputSchema: { caseId: CASE_ID, member: MEMBER, status: z.enum(["done", "not_yet"]) },
    },
    audited(audit, "tool", "record_checkin", async (args: { caseId: string; member: string; status: "done" | "not_yet" }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        const commitment = store.list(args.caseId).filter(isCommitment).filter((e) => e.member === args.member).at(-1);
        if (!commitment) throw new InvalidInputError("No step committed yet");
        store.append({ type: "checkin", at: new Date().toISOString(), caseId: args.caseId, member: args.member, label: commitment.label, status: args.status });
        const priority = planPriorities(raw).find((p) => p.index === commitment.priorityIndex);
        return { ok: true, next: args.status === "not_yet" && priority ? { topicId: priority.topicId, level: "simple" as const, attempt: 0 } : null };
      }),
    ),
  );

  server.registerTool(
    "log_question",
    {
      title: "Ask the advisor",
      description:
        "Stores a question the person asked that the plan on screen didn't answer. It goes to the advisor's brief; nothing is answered automatically.",
      inputSchema: { caseId: CASE_ID, member: MEMBER, topicId: TOPIC_ID, text: z.string().min(3).max(500) },
    },
    audited(audit, "tool", "log_question", async (args: { caseId: string; member: string; topicId: string; text: string }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        const text = args.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        store.append({ type: "question", at: new Date().toISOString(), caseId: args.caseId, member: args.member, topicId: args.topicId, text });
        return { ok: true };
      }),
    ),
  );

  server.registerTool(
    "get_audio",
    {
      title: "Get a capsule's audio",
      description:
        "Audio for a capsule, generated once and cached. Returns { kind: 'audio', audioId } (an mp3 in the cache) or, with no key " +
        "or when the voice budget is used up, { kind: 'browser', text } so the client reads it with the device's own voice. " +
        "With intro: true, it speaks the member's future-self opening line instead of a capsule.",
      inputSchema: {
        caseId: CASE_ID,
        topicId: TOPIC_ID,
        level: LEVEL.default("standard"),
        member: MEMBER.optional(),
        attempt: ATTEMPT.default(0),
        intro: z.boolean().optional(),
        stream: z.boolean().optional().describe("Answer at once with { kind: 'stream', audioId } and generate in the background"),
      },
    },
    audited(audit, "tool", "get_audio", async (args: { caseId: string; topicId: string; level: Level; member?: string; attempt?: number; intro?: boolean; stream?: boolean }) =>
      guard(async () => {
        const raw = await source.getCase(args.caseId);
        checkMember(raw, args.member);
        if (args.intro) {
          const f = args.member && args.member !== "together" ? futureSelf(raw, args.member) : futureSelves(raw)[0];
          if (!f) throw new InvalidInputError("The plan does not give enough to build this future self");
          return speak(f.introText, coach, { stream: args.stream });
        }
        if (!TOPICS.some((t) => t.id === args.topicId)) throw new UnknownTopicError(args.topicId);
        const capsule =
          args.level === "simple"
            ? await simpleCapsule(raw, args.topicId, args.member ?? null, args.attempt ?? 0, coach)
            : buildCapsule(raw, { topicId: args.topicId, level: args.level, member: args.member ?? null });
        return capsuleAudio(capsule, coach, { stream: args.stream });
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
        attempt: z.string().optional().describe("0 plain words, 1 one number, 2 analogy"),
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

function nextOrNull(raw: RawCase, member: string, topicId: string) {
  const id = nextTopicFor(raw, member, topicId);
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
    if (err instanceof UnknownCaseError || err instanceof UnknownTopicError || err instanceof InvalidMemberError || err instanceof InvalidInputError) {
      const error = { code: err.code, message: err.message };
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error }) }] };
    }
    throw e;
  }
}
