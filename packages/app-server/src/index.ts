// Backend for the web app. Holds the keys (from D2 on), talks to plan-coach over MCP,
// and serves the built web app. The browser never sees a key or the raw plan files.
import { existsSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
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

app.get("/api/cases/:caseId/topics", async (c) => {
  const member = c.req.query("member");
  const uri = member ? `plan://${enc(c.req.param("caseId"))}/topics/${enc(member)}` : `plan://${enc(c.req.param("caseId"))}/topics`;
  return c.json(await coach.readJson(uri));
});

/**
 * Prefetches run here, in the background, and the browser gets 202 at once: a request held open
 * for a slow generation would take one of the browser's six connections and make taps wait.
 */
function background(job: () => Promise<unknown>): boolean {
  void job().catch(() => undefined);
  return true;
}

app.get("/api/cases/:caseId/capsule", async (c) => {
  const q = c.req.query();
  const args = {
    caseId: c.req.param("caseId"),
    topicId: q.topic ?? "",
    level: q.level ?? "standard",
    ...(q.member ? { member: q.member } : {}),
    ...(q.attempt ? { attempt: Number(q.attempt) } : {}),
  };
  if (q.prefetch) return c.json({ started: background(() => coach.call("get_capsule", args)) }, 202);
  return c.json(await coach.call("get_capsule", args));
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
    await coach.call("commit_step", { caseId: c.req.param("caseId"), member: body.member, priorityIndex: body.priorityIndex, dueDate: body.dueDate }),
  );
});

app.post("/api/cases/:caseId/rankings", bodyLimit({ maxSize: 2 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(await coach.call("submit_ranking", { caseId: c.req.param("caseId"), member: body.member, order: body.order }));
});

app.get("/api/cases/:caseId/agreement", async (c) => c.json(await coach.call("get_agreement", { caseId: c.req.param("caseId") })));

app.post("/api/cases/:caseId/questions", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(
    await coach.call("log_question", { caseId: c.req.param("caseId"), member: body.member, topicId: body.topicId, text: body.text }),
  );
});

app.post("/api/cases/:caseId/checkins", bodyLimit({ maxSize: 2 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(await coach.call("record_checkin", { caseId: c.req.param("caseId"), member: body.member, status: body.status }));
});

app.post("/api/cases/:caseId/audio", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const args = {
    caseId: c.req.param("caseId"),
    topicId: body.topicId,
    level: body.level ?? "standard",
    ...(typeof body.member === "string" ? { member: body.member } : {}),
    ...(typeof body.attempt === "number" ? { attempt: body.attempt } : {}),
    ...(body.intro === true ? { intro: true } : {}),
    stream: true,
  };
  const result = await coach.call<{ kind: string; audioId?: string; text?: string }>("get_audio", args);
  if (result.kind === "audio") return c.json({ kind: "audio", url: `/api/audio/${result.audioId}` });
  if (result.kind === "stream") return c.json({ kind: "stream", url: `/api/audio/${result.audioId}/stream` });
  return c.json(result);
});

/**
 * The voice while it is being generated: raw 16-bit PCM at 24 kHz, sent as plan-coach writes it
 * (`<id>.part`), then the rest from the finished WAV. Playback starts in a second or two instead
 * of waiting for the whole reading. Ends early if the generation fails (the part disappears).
 */
app.get("/api/audio/:id/stream", (c) => {
  const id = c.req.param("id");
  if (!/^[a-f0-9]{32}$/.test(id)) return c.json({ error: { code: "BAD_ID", message: "Unknown audio" } }, 400);
  const part = resolve(AUDIO_DIR, `${id}.part`);
  const done = resolve(AUDIO_DIR, `${id}.wav`);
  c.header("content-type", "audio/L16; rate=24000; channels=1");
  c.header("cache-control", "no-store");
  return stream(c, async (out) => {
    let sent = 0; // PCM bytes
    const started = Date.now();
    const readFrom = async (file: string, offset: number, upTo?: number) => {
      const fh = await open(file, "r");
      try {
        const size = upTo ?? (await fh.stat()).size;
        if (size <= offset) return 0;
        const buf = Buffer.alloc(size - offset);
        await fh.read(buf, 0, buf.length, offset);
        await out.write(new Uint8Array(buf));
        return buf.length;
      } finally {
        await fh.close();
      }
    };
    while (!out.aborted && Date.now() - started < 180_000) {
      if (existsSync(done)) {
        sent += await readFrom(done, 44 + sent); // the WAV is header + the same PCM
        return;
      }
      if (existsSync(part)) sent += await readFrom(part, sent);
      else if (Date.now() - started > 15_000) return; // never started, or failed and was removed
      await out.sleep(120);
    }
  });
});

// Cached mp3s, by content hash only: no paths from the client reach the file system.
app.get("/api/audio/:id", (c) => {
  const id = c.req.param("id");
  if (!/^[a-f0-9]{32}$/.test(id)) return c.json({ error: { code: "BAD_ID", message: "Unknown audio" } }, 400);
  const found = (["mp3", "wav"] as const).map((ext) => ({ ext, file: resolve(AUDIO_DIR, `${id}.${ext}`) })).find((f) => existsSync(f.file));
  if (!found) return c.json({ error: { code: "NOT_FOUND", message: "Unknown audio" } }, 404);
  const type = found.ext === "mp3" ? "audio/mpeg" : "audio/wav";
  return c.body(readFileSync(found.file), 200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
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
    ...(typeof body.attempt === "number" ? { attempt: body.attempt } : {}),
  });
  return c.json(result);
});

// ---- consent and the advisor's side --------------------------------------------------------

app.get("/api/cases/:caseId/consent", async (c) => c.json(await coach.call("get_consent", { caseId: c.req.param("caseId") })));

app.post("/api/cases/:caseId/consent", bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  return c.json(await coach.call("set_consent", { caseId: c.req.param("caseId"), member: body.member, share: body.share }));
});

app.get("/api/cases/:caseId/advisor-brief", async (c) => {
  c.header("cache-control", "no-store");
  return c.json(await coach.call("get_advisor_brief", { caseId: c.req.param("caseId") }));
});

app.post("/api/cases/:caseId/reset", async (c) => c.json(await coach.call("reset_case", { caseId: c.req.param("caseId") })));

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
