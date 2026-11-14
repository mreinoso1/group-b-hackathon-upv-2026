// Backend for the web app. Holds the keys (from D2 on), talks to plan-coach over MCP,
// and serves the built web app. The browser never sees a key or the raw plan files.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CoachError, connectCoach } from "./coach.ts";

// API_PORT, not PORT: dev tools often set PORT for the web dev server.
const PORT = Number(process.env.API_PORT ?? 8080);
const HOST = process.env.HOST ?? "127.0.0.1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB_DIST = resolve(REPO_ROOT, "packages/web/dist");
const AUDIO_DIR = resolve(REPO_ROOT, process.env.CACHE_DIR ?? "cache", "audio");

const coach = await connectCoach();
const app = new Hono();

app.onError((err, c) => {
  if (err instanceof CoachError) {
    const status = err.code.startsWith("UNKNOWN") ? 404 : 400;
    return c.json({ error: { code: err.code, message: err.message } }, status);
  }
  console.error(err);
  return c.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500);
});

const enc = encodeURIComponent;

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/cases", async (c) => c.json(await coach.readJson("plan://cases")));

app.get("/api/cases/:caseId/topics", async (c) => c.json(await coach.readJson(`plan://${enc(c.req.param("caseId"))}/topics`)));

app.get("/api/cases/:caseId/capsule", async (c) => {
  const q = c.req.query();
  const capsule = await coach.call("get_capsule", {
    caseId: c.req.param("caseId"),
    topicId: q.topic ?? "",
    level: q.level ?? "standard",
    ...(q.member ? { member: q.member } : {}),
    ...(q.attempt ? { attempt: Number(q.attempt) } : {}),
  });
  return c.json(capsule);
});

app.get("/api/cases/:caseId/future-self", async (c) => {
  const member = c.req.query("member");
  return c.json(await coach.call("get_future_self", { caseId: c.req.param("caseId"), ...(member ? { member } : {}) }));
});

app.get("/api/cases/:caseId/first-step", async (c) => {
  const member = c.req.query("member");
  return c.json(await coach.call("get_first_step", { caseId: c.req.param("caseId"), ...(member ? { member } : {}) }));
});

app.post("/api/cases/:caseId/commitments", bodyLimit({ maxSize: 2 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(
    await coach.call("commit_step", { caseId: c.req.param("caseId"), member: body.member, moveIndex: body.moveIndex, dueDate: body.dueDate }),
  );
});

app.post("/api/cases/:caseId/checkins", bodyLimit({ maxSize: 2 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(await coach.call("record_checkin", { caseId: c.req.param("caseId"), member: body.member, status: body.status }));
});

app.post("/api/cases/:caseId/audio", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const result = await coach.call<{ kind: string; audioId?: string; text?: string }>("get_audio", {
    caseId: c.req.param("caseId"),
    topicId: body.topicId,
    level: body.level ?? "standard",
    ...(typeof body.member === "string" ? { member: body.member } : {}),
    ...(typeof body.attempt === "number" ? { attempt: body.attempt } : {}),
    ...(body.intro === true ? { intro: true } : {}),
  });
  return c.json(result.kind === "audio" ? { kind: "audio", url: `/api/audio/${result.audioId}` } : result);
});

// Cached mp3s, by content hash only: no paths from the client reach the file system.
app.get("/api/audio/:id", (c) => {
  const id = c.req.param("id");
  if (!/^[a-f0-9]{32}$/.test(id)) return c.json({ error: { code: "BAD_ID", message: "Unknown audio" } }, 400);
  const file = resolve(AUDIO_DIR, `${id}.mp3`);
  if (!existsSync(file)) return c.json({ error: { code: "NOT_FOUND", message: "Unknown audio" } }, 404);
  return c.body(readFileSync(file), 200, { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" });
});

app.post("/api/cases/:caseId/reactions", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const result = await coach.call("record_reaction", {
    caseId: c.req.param("caseId"),
    member: body.member,
    topicId: body.topicId,
    level: body.level,
    reaction: body.reaction,
    ...(typeof body.dwellMs === "number" ? { dwellMs: Math.round(body.dwellMs) } : {}),
  });
  return c.json(result);
});

if (existsSync(WEB_DIST)) {
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("*", serveStatic({ path: resolve(WEB_DIST, "index.html") }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, ({ port }) => {
  console.log(`app-server on http://${HOST}:${port}${existsSync(WEB_DIST) ? " (serving web/dist)" : " (API only; run the web dev server)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void coach.close().finally(() => process.exit(0));
  });
}
