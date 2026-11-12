// Voice example: talk to a realtime model about one of the cases, with your own microphone.
//
//   npm install && cp .env.example .env   (put your team key in .env)
//   npm start                               ->  http://localhost:5173 in Chrome
//
// Your team key stays here, on the server. The page talks to this server over a
// WebSocket, and this server passes every message on to the AI proxy's /v1/realtime
// and back. The only message it changes is the page's session.update, where it adds
// the chosen family's plan to the model's instructions, so the case data stays here too.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const PROXY_URL = (process.env.LLM_PROXY_URL || "https://llm-hackathon.sherpaswealth.com").replace(/\/$/, "");
const TEAM_KEY = process.env.TEAM_KEY;
const PORT = Number(process.env.PORT || 5173);
const CASES_DIR = resolve(here, process.env.CASES_DIR || "../../cases");
const MODELS = ["gpt-realtime-2.1-mini", "gpt-realtime-2.1", "gemini-3.8-live"];
if (!TEAM_KEY || TEAM_KEY.includes("...")) {
  console.error("Put your team's AI key in examples/voice/.env as TEAM_KEY=sk-... (copy .env.example)");
  process.exit(1);
}

// ---- Cases: read straight from the repo's cases/ folder -------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
const caseIds = existsSync(CASES_DIR)
  ? readdirSync(CASES_DIR).filter((id) => existsSync(join(CASES_DIR, id, "financial-health.json"))).sort()
  : [];

function caseLabel(id) {
  const fh = readJson(join(CASES_DIR, id, "financial-health.json"));
  const adults = (fh?.case?.household ?? []).filter((p) => p.role !== "child").map((p) => p.first_name);
  return `${adults.join(" & ") || id}${fh?.case?.city ? `, ${fh.case.city}` : ""}${fh?.score ? ` (score ${fh.score.published_score})` : ""}`;
}

// A short brief for the model: who the family is, their score and Sherpas' written summary.
// About 1,500 tokens. Add more sections (narrative.*, goals, key_metrics) if your idea needs them.
function caseBrief(id) {
  const fh = readJson(join(CASES_DIR, id, "financial-health.json"));
  if (!fh) return "";
  const people = (fh.case?.household ?? []).map((p) => `${p.first_name} (${p.role}, ${p.age})`).join(", ");
  return [
    `You are talking with this family about their financial plan from Sherpas. Use only these figures; never invent numbers.`,
    `Household: ${people}. ${fh.case?.city ?? ""}, ${fh.case?.state ?? ""}.`,
    fh.score && `Financial health score: ${fh.score.published_score}/100 (${fh.score.band}).`,
    fh.narrative?.summary_main && `Summary of the plan:\n${fh.narrative.summary_main}`,
    fh.narrative?.summary_recommendations && `Recommendations:\n${fh.narrative.summary_recommendations}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---- HTTP: the page, its audio worklet, and the list of cases -------------------

const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/mic-worklet.js": ["mic-worklet.js", "text/javascript; charset=utf-8"],
};
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/cases") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(caseIds.map((id) => ({ id, label: caseLabel(id) }))));
  }
  const file = files[path];
  if (!file) return res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": file[1], "cache-control": "no-store" });
  res.end(readFileSync(join(here, "public", file[0])));
});

// ---- WebSocket relay: browser <-> this server <-> AI proxy ----------------------

const wss = new WebSocketServer({ server, path: "/voice" });
wss.on("connection", (browser, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const model = params.get("model");
  const caseId = params.get("case");
  if (!MODELS.includes(model)) return browser.close(1008, "unknown model");
  if (caseId && !caseIds.includes(caseId)) return browser.close(1008, "unknown case");
  const brief = caseId ? caseBrief(caseId) : "";

  const upstream = new WebSocket(`${PROXY_URL.replace(/^http/, "ws")}/v1/realtime?model=${model}`, {
    headers: { Authorization: `Bearer ${TEAM_KEY}` },
  });
  const pending = []; // messages from the page that arrive before the proxy connection is open
  console.log(`[${model}] session opened${caseId ? ` for ${caseId}` : ""}`);

  upstream.on("open", () => {
    for (const m of pending.splice(0)) upstream.send(m);
  });
  upstream.on("message", (data) => browser.readyState === WebSocket.OPEN && browser.send(data.toString()));
  upstream.on("unexpected-response", (_req, res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      console.log(`[${model}] proxy refused: HTTP ${res.statusCode} ${body.slice(0, 200)}`);
      browser.send(JSON.stringify({ type: "error", error: { message: `proxy HTTP ${res.statusCode}: ${body.slice(0, 200)}` } }));
      browser.close();
    });
  });
  upstream.on("close", (code, reason) => {
    console.log(`[${model}] proxy closed ${code} ${reason}`);
    browser.close();
  });
  upstream.on("error", (e) => console.log(`[${model}] proxy error ${e.message}`));

  browser.on("message", (data) => {
    let m = data.toString();
    if (brief && m.includes('"session.update"')) {
      const ev = JSON.parse(m);
      if (ev.type === "session.update" && ev.session) {
        ev.session.instructions = `${ev.session.instructions ?? ""}\n\n${brief}`.trim();
        m = JSON.stringify(ev);
      }
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(m);
    else pending.push(m);
  });
  browser.on("close", () => {
    console.log(`[${model}] session closed`);
    upstream.close();
  });
});

server.listen(PORT, () => {
  console.log(`Voice example on http://localhost:${PORT}  (proxy ${PROXY_URL}, ${caseIds.length} cases from ${CASES_DIR})`);
});
