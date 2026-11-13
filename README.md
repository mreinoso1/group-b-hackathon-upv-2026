# One Bite — your plan, one bite at a time

**Sherpas x UPV Sigma Data Club hackathon, November 2026.** The original challenge brief is in [`docs/CHALLENGE.md`](docs/CHALLENGE.md).

Sherpas already writes a good plan. The problem is the **amount** and the **format**: a family gets everything at once, on one screen, at one pace. In a meeting the advisor *calibrates*: they see a confused face and explain it another way. One Bite brings that back when nobody is in the room.

- **Calibrated capsules.** One idea of the plan at a time, 30–60 seconds, with a chart. Each one ends with *Got it* / *I'm lost* / *Tell me more*. *I'm lost* re-explains it for that person (an analogy, then step by step, then the one number that matters), in a tone set by their profile; *Tell me more* shows the full detail and every figure with where it sits in the plan. *Listen* reads it aloud.
- **The plan's own words.** Capsules are the plan's text, dosed, never rewritten. Every number comes from the plan JSON; if something is missing, we say so.
- **Each person at their own pace.** Couples pick who is reading; every reaction is recorded per person.
- **Our own MCP server, `plan-coach`.** The app reaches the plan only through MCP tools and resources, so any MCP host (Claude Desktop, an advisor's assistant) can use the same capsules.

Works for all four families in [`cases/`](cases/); the demo family is Timothy and Melanie Weah.

## Run it in under 5 minutes

You need **Node 22 or later** (`winget install OpenJS.NodeJS.LTS` on Windows, or nodejs.org).

```bash
npm install
npm run dev
```

Open http://localhost:5173 (best in a phone-sized window). The first start takes a few seconds while the API launches `plan-coach`.

It works without keys: it reads the plan from `cases/`, *I'm lost* shows the plan's own sentence about the reader, and *Listen* uses the device's voice. With keys, copy `.env.example` to `.env` at the repo root (git ignores it) and fill `TEAM_KEY`: *I'm lost* then uses `gpt-5-mini` and *Listen* uses `eleven-flash-v2.5`. Only the `plan-coach` process reads the keys; never put them in the web app.

**How model output stays safe.** Every re-explanation is sanitised (plain text only) and checked before anyone sees it: each number must appear in that part of the plan (`$110,000` passes, `about $100,000` does not), and it may only name people that part of the plan names (so a debt is never handed to the wrong partner). It gets one corrective retry; otherwise the person sees the plan's own words. Results are cached by content (`cache/`), so a repeat is instant and free, and *I'm lost* is prepared in the background while the capsule is read. Spend is capped per service (`TEXT_BUDGET_USD`, `TTS_BUDGET_USD`); past a cap the app falls back instead of failing.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Tests for the plan logic and every MCP tool and resource, on all four families |
| `npm run typecheck` | TypeScript check of all packages |
| `npm start` | Builds the web app and serves it from the API on http://127.0.0.1:8080 |
| `npm run mcp:http` | `plan-coach` alone over Streamable HTTP at http://127.0.0.1:8787/mcp (for MCP Inspector) |
| `npm run mcp:stdio` | `plan-coach` alone over stdio (for Claude Desktop) |

## Architecture

```
phone browser ──HTTP──▶ app-server (Hono) ──MCP over stdio──▶ plan-coach (MCP server) ──▶ cases/*.json
   web (React)            keys live here only                    resources · tools · audit log
```

| Package | Role |
|---|---|
| [`packages/plan-core`](packages/plan-core) | Pure TypeScript: loads a case, builds the topic catalog, slices the plan into capsules, builds chart specs. No network. |
| [`packages/plan-coach-mcp`](packages/plan-coach-mcp) | The MCP server. Logs every call to `data/audit.jsonl` (credentials redacted) and reactions to `data/events.jsonl`. |
| [`packages/app-server`](packages/app-server) | Backend for the web app: an MCP client of `plan-coach`, plus a small REST API. |
| [`packages/web`](packages/web) | Mobile-first web app. Charts are plain SVG from the capsule's chart spec. |

### `plan-coach` MCP contract (current)

**Resources**

| URI | Content |
|---|---|
| `plan://cases` | The families: members, children, score |
| `plan://{caseId}/overview` | Score, the plan's summary and goals |
| `plan://{caseId}/advice` | Recommendations in the plan's order, top moves, combined moves |
| `plan://{caseId}/living-map` | Year-by-year projection and life milestones |
| `plan://{caseId}/topics` | The capsule catalog |
| `plan://{caseId}/persona` | Advisor-only: tone and order hints, never shown to the family |

**Tools**

| Tool | Input | Output |
|---|---|---|
| `get_capsule` | `caseId`, `topicId`, `level` (`standard` · `simple` · `expert`), `member?`, `attempt?` | Capsule: text blocks with their source, chart spec, figures with their plan section, `missing`; for `simple`, `planWords`, `style` and `check` |
| `record_reaction` | `caseId`, `member`, `topicId`, `level`, `reaction` (`got_it` · `lost` · `tell_me_more`), `dwellMs?` | `next`: what to show next (`attempt` grows with each *I'm lost* in a row) |
| `get_audio` | same as `get_capsule` | `{ kind: "audio", audioId }` (cached mp3) or `{ kind: "browser", text }` |

**Prompts**

| Prompt | Args | Use |
|---|---|---|
| `explain_simple` | `caseId`, `topicId`, `member?`, `attempt?` | The *I'm lost* request: the plan text grouped by person, the allowed numbers, the way in and the voice |
| `explain_expert` | `caseId`, `topicId` | Follow-up questions on one idea with the full text and every figure; answers stay inside the plan |

Coming next: prompt `future_self`; tools `submit_ranking`, `get_agreement`, `set_consent`, `schedule_nudge`, `get_advisor_brief`, `log_question`.

## Rules we hold ourselves to

- No invented figures: every number on screen comes from the plan JSON, and the expert view shows where.
- The order of competing priorities is the family's call, never the app's.
- Keys stay in the backend `.env`: never in the web app, logs or commits.
