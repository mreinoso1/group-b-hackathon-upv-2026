# Future You — your plan, explained by your future self

**Sherpas x UPV Sigma Data Club hackathon, November 2026.** The original challenge brief is in [`docs/CHALLENGE.md`](docs/CHALLENGE.md).

Sherpas already writes a good plan. The problem is the **amount** and the **format**: a family gets everything at once, on one screen, at one pace, in a new language, with nobody beside them. And the hardest part of any plan is seeing how a choice today changes your life years from now. **Future You** hands the plan to the one messenger nobody ignores: yourself, years from now. In a meeting the advisor *calibrates*; Future You does that when nobody is in the room, moves each person to one first step, comes back until they take it, and hands the advisor what happened.

**For the family (phone):**

- **A message from your future self.** Each adult opens a video message from themselves at the age where their plan is decided: Michael at 85, the year his plan says his savings run out; Samantha at 73, despite a score of 82; the couples at retirement, with what the plan puts on the way (the home, the children's college) and, where the plan shows it, the gap still to close. One tap plays it, with sound. The age, the year and every word come from the plan (`futureSelves` in `plan-core`); nothing is promised that the plan doesn't show.
- **Calibrated capsules, one bite at a time.** Then the plan, one idea at a time, 30–60 seconds, with a chart, each introduced by the future self. Each one ends with *Got it* / *I'm lost* / *Tell me more*. *I'm lost* re-explains it for that person (plain words, then the one number that matters, then an analogy), in a tone set by their profile; *Tell me more* shows the full detail and every figure with where it sits in the plan. *Listen* reads it aloud.
- **One first step, made real.** Not ten recommendations: one step from the plan's own top moves, in plain words, with what it does to the score. The person picks a date, and *Make it real* puts the step and a reminder before each big date of the plan in their own calendar (a standard `.ics`, for Google, Outlook or Apple). On day 3 the future self asks "Did you do it?" and, if not, explains it another way.
- **The plan's own words.** Capsules are the plan's text, dosed, never rewritten. Every number comes from the plan JSON; if something is missing, we say so. A red score is never the first thing they see: the plan's own summary, which starts from their strengths, comes first.
- **Each person at their own pace.** Couples pick who is reading; each hears their own future self, orders the plan's priorities, and the app shows where they agree and differ. The order is always theirs.

**For the advisor (laptop):** a live brief at `/advisor/<caseId>`: what each person understood (skip it), where they said *I'm lost* and which explanation finally worked, what they asked, the step they chose, where a couple differs, and a three-item agenda that cites the evidence and flags when the persona predicted it. Only what each person chose to share.

**Two MCP servers.** `plan-coach` (ours) reads each family's plan from the **Sherpas MCP** and serves it as capsules, the future self, the first step and the advisor brief, so any MCP host (Claude Desktop, an advisor's assistant) can use them too.

Works for all four families; the demo family is **Michael Carter**. The home page lists the four example families for the demo; in real life each person would get a link straight to their own message.

**The future selves' faces and voices.** The families are fictional, so each future self was designed once: an illustrated portrait at their future age, a voice designed in ElevenLabs (Voice Design), and a talking video made from both (ElevenLabs lip sync, HeyGen Avatar 4). They live in `packages/web/public/` (`avatars/`, `audio/`, `video/`), named `<caseId>-<memberId>`; `npm run voices` checks that every recording says exactly the line the app shows. For a real client this would be their own photo and voice, only with their consent.

## Run it in under 5 minutes

You need **Node 22 or later** (`winget install OpenJS.NodeJS.LTS` on Windows, or nodejs.org).

```bash
npm install
npm run dev
```

- **The family:** http://localhost:5173 (best in a phone-sized window). The first start takes a few seconds while the API launches `plan-coach`.
- **The advisor:** http://localhost:5173/advisor/michael-carter (any case id). It fills in every 2 seconds while the family uses the app; **Reset** starts that family over for the next demo.

**Demo with phones (judges try it on their own phone).** Run `npm run demo` instead: the same app, listening on the Wi-Fi. Open http://localhost:5173/demo on the laptop, pick a family, and it creates a **room** (a 4-letter code) with a QR code per person and the advisor link for that room. Each phone that scans a QR opens straight at that person's start; whatever they tap stays in that room, so several groups can try the same family at once without mixing, and **Reset** on the advisor screen clears only that room. The laptop and the phones must be on the same Wi-Fi; the first time, allow Node through the Windows firewall when it asks. Without a room code the app uses the default room, as before.

**It works without keys.** It reads the plan from `cases/`, and every *I'm lost* explanation is already in `cache/` (checked by `npm run explanations -- --check`), so the core of the app runs fully offline; *Listen* then uses the device's English voice. With keys, copy `.env.example` to `.env` at the repo root (git ignores it) and fill it in. Only the `plan-coach` process reads the keys; never put them in the web app.

- `MCP_TOKEN`: the plan comes from the Sherpas MCP (`list_cases`, `get_case`). The token lasts 72 hours; when it is missing or refused, `plan-coach` logs it, reads the same JSON from `cases/` and tries the MCP again a minute later, so the app never stops. `plan://cases` reports which one answered (`dataSource`). `CASES_SOURCE=local` skips the MCP.
- `TEAM_KEY`: new explanations use `gpt-5-mini`; *Listen* uses `eleven-flash-v2.5`, or a realtime voice model when the proxy refuses it.

**How model output stays safe.** Every re-explanation is sanitised (plain text only) and checked before anyone sees it: each number must appear in that part of the plan (`$110,000` passes, `about $100,000` does not); it may only name people that part of the plan names (so a debt is never handed to the wrong partner); and its tone is checked (no advisor voice, no "seek help", no repeating the plan's judgments about their life). It gets one corrective retry; otherwise the person sees the plan's own words. Results are cached by content (`cache/`), so a repeat is instant and free. Spend is capped per service (`TEXT_BUDGET_USD`, `TTS_BUDGET_USD`, `VOICE_BUDGET_USD`); past a cap the app falls back instead of failing.

**Listen is always in English.** Audio comes from ElevenLabs; if the proxy refuses it, a realtime voice model reads the text (`gpt-realtime-2.1-mini`, then `gemini-3.8-live`). Its transcript must match the text, words and numbers; Gemini returns none, so its length must fit the text instead. The device's own voice is a last resort and only if it has an English voice.

**Consent.** Before their first idea, each person chooses whether to share how it went with their advisor, with a plain list of what is and isn't shared. Without a yes the advisor sees "has not shared yet" and nothing else; couple items need both partners; a question sent to the advisor is shared on its own.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Tests for the plan logic, the advisor brief and every MCP tool and resource, on all four families |
| `npm run typecheck` | TypeScript check of all packages |
| `npm run explanations` | Generates any missing *I'm lost* explanation (needs `TEAM_KEY`); `-- --check` only reports, `-- --prune` removes stale ones |
| `npm run voices` | The exact line each future-self recording must say, and whether each recording matches it |
| `npm run demo` | Like `npm run dev`, but phones on the same Wi-Fi can open it (for the QR codes on `/demo`) |
| `npm start` | Builds the web app and serves it from the API on http://127.0.0.1:8080 |
| `npm run mcp:http` | `plan-coach` alone over Streamable HTTP at http://127.0.0.1:8787/mcp (for MCP Inspector) |
| `npm run mcp:stdio` | `plan-coach` alone over stdio (for Claude Desktop) |

## Architecture

```
phone browser ──┐
                ├─HTTP─▶ app-server (Hono) ──MCP over stdio──▶ plan-coach (MCP server) ──MCP over HTTP──▶ Sherpas MCP
advisor laptop ─┘                                               resources · tools · audit log         (falls back to cases/*.json)
                                                                keys live here only
```

| Package | Role |
|---|---|
| [`packages/plan-core`](packages/plan-core) | Pure TypeScript, no network: loads a case, builds the topic catalog, slices the plan into capsules and chart specs, the future self, the priorities and the couple's agreement, and the advisor brief. |
| [`packages/plan-coach-mcp`](packages/plan-coach-mcp) | The MCP server, and a client of the Sherpas MCP ([`sherpas.ts`](packages/plan-coach-mcp/src/sherpas.ts): each part fetched once per process, at most 4 calls at once). Logs every call to `data/audit.jsonl` (credentials redacted) and what the family does to `data/events.jsonl`. |
| [`packages/app-server`](packages/app-server) | Backend for the web app: an MCP client of `plan-coach`, plus a small REST API. |
| [`packages/web`](packages/web) | Mobile-first web app for the family, and the desktop advisor screen. Charts are plain SVG from the capsule's chart spec. |

### `plan-coach` MCP contract

**Resources**

| URI | Content |
|---|---|
| `plan://cases` | The families: members, children, score, and `dataSource` (`sherpas` or `local`) |
| `plan://{caseId}/overview` | Score, the plan's summary and goals |
| `plan://{caseId}/advice` | Recommendations in the plan's order, top moves, combined moves |
| `plan://{caseId}/living-map` | Year-by-year projection and life milestones |
| `plan://{caseId}/topics` | The capsule catalog; `plan://{caseId}/topics/{member}` in that reader's order |
| `plan://{caseId}/persona` | Advisor-only: tone and order hints, never shown to the family |
| `plan://{caseId}/advisor-brief` | Advisor-only: same as `get_advisor_brief` |

**Tools**

| Tool | Input | Output |
|---|---|---|
| `get_capsule` | `caseId`, `topicId`, `level` (`standard` · `simple` · `expert`), `member?`, `attempt?` | Capsule: text blocks with their source, chart spec, figures with their plan section, `missing`; for `simple`, `planWords`, `style` and `check`; for `standard`, the future self's line |
| `record_reaction` | `caseId`, `member`, `topicId`, `level`, `reaction` (`got_it` · `lost` · `tell_me_more`), `dwellMs?`, `attempt?` | `next`: what to show next (`attempt` grows with each *I'm lost* in a row) |
| `get_future_self` | `caseId`, `member?` | The age each adult's future self speaks from (retirement, or the last year with savings when the plan says they run out), the opening line, and upcoming plan dates to check in |
| `get_first_step` | `caseId`, `member?` | The plan's priorities (`summary_recommendations`, in order) with a plain label, the plan's sentence, the capsule that explains it and its score effect; `suggested` is the plan's first, or the couple's shared first. Plus the commitment and check-ins |
| `submit_ranking` · `get_agreement` | `caseId`, `member`, `order` · `caseId` | One partner's order of the priorities; where the partners agree and differ (it never ranks for them) |
| `commit_step` | `caseId`, `member`, `priorityIndex`, `dueDate` | Stores "I'll do it by…" (today to one year ahead) |
| `record_checkin` | `caseId`, `member`, `status` (`done` · `not_yet`) | Stores the answer; `not_yet` returns the capsule that explains the step |
| `log_question` | `caseId`, `member`, `topicId`, `text` | Stores a question for the advisor (shared on its own) |
| `set_consent` · `get_consent` | `caseId`, `member`, `share` · `caseId` | Each adult's choice to share with the advisor; the latest counts |
| `get_advisor_brief` | `caseId` | Per person: understood, stuck (and what landed), wanted more, skipped, not reached, questions, first step, check-in; the couple's agreement quoting the plan; an agenda of up to three items, each citing its events and flagged when a persona tension predicted it |
| `reset_case` | `caseId` | Deletes everything recorded for one family (demos) |
| `get_audio` | same as `get_capsule`, plus `intro?`, `stream?` | `{ kind: "audio" }` (cached), `{ kind: "stream" }` (being generated) or `{ kind: "browser", text }` |

Every tool that reads or writes what the family did (`record_reaction`, `get_first_step`, `submit_ranking`, `get_agreement`, `commit_step`, `record_checkin`, `log_question`, `set_consent`, `get_consent`, `get_advisor_brief`, `reset_case`) also takes `room?`: a 4-letter demo room. What is recorded in one room never mixes with another; without it, the default room. The REST API reads it from `?room=`.

**Prompts**

| Prompt | Args | Use |
|---|---|---|
| `explain_simple` | `caseId`, `topicId`, `member?`, `attempt?` | The *I'm lost* request: the plan text grouped by person, the allowed numbers, the way in and the voice |
| `explain_expert` | `caseId`, `topicId` | Follow-up questions on one idea with the full text and every figure; answers stay inside the plan |

Not built: scheduled reminders (`schedule_nudge`). Check-ins are shown in the app instead.

## Rules we hold ourselves to

- No invented figures: every number on screen comes from the plan JSON, and the expert view shows where.
- The order of competing priorities is the family's call, never the app's.
- Nothing a person taps reaches the advisor without their consent.
- Keys stay in the backend `.env`: never in the web app, logs or commits.
