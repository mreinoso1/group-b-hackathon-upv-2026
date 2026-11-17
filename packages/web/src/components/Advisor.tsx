import { useCallback, useEffect, useRef, useState } from "react";
import type { AgendaItem, CoupleBrief, Evidence, PersonBrief, StuckTopic, Tension } from "@bite/plan-core";
import { advisorApi, type AdvisorBrief } from "../api-advisor.ts";
import { ROOM } from "../room.ts";
import "./advisor.css";

const LANDED: Record<string, string> = { plain: "plain words", one_number: "the one number", analogy: "an analogy" };
const POLL_MS = 2000;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The advisor's side, at /advisor/:caseId: what the family understood, got stuck on, asked and
 * chose, filling in live while they use the app. Only what each person chose to share.
 */
export function AdvisorScreen({ caseId }: { caseId: string }) {
  const [brief, setBrief] = useState<AdvisorBrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBrief(await advisorApi.brief(caseId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Confirmed in the page: window.confirm() is silently blocked in some browsers and embedded
  // views (it returns "cancel" without showing anything), which made Reset do nothing.
  const [confirming, setConfirming] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const reset = async () => {
    setConfirming(false);
    try {
      const r = await advisorApi.reset(caseId);
      setResetNote(`Started over: ${r.removed} recorded event${r.removed === 1 ? "" : "s"} deleted.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!brief) return <div className="advisor-page">{error ? <p className="error">{error}</p> : <p className="muted">Loading the brief…</p>}</div>;

  const columns = brief.people;
  return (
    <div className="advisor-page">
      <header className="adv-head">
        <div>
          <p className="adv-kicker">Before your meeting</p>
          <h1>{brief.household}</h1>
        </div>
        {ROOM ? (
          <p className="adv-score">
            Room <strong>{ROOM}</strong>
          </p>
        ) : null}
        <p className="adv-score">
          Financial Health Score <strong>{brief.score}</strong> · {brief.band}
        </p>
        <p className="adv-live" aria-live="polite">
          <span className="adv-dot" aria-hidden="true" />
          {brief.lastActivity ? `Live · last activity ${time(brief.lastActivity)}` : "Live · waiting for the family"}
        </p>
        {confirming ? (
          <span className="adv-confirm" role="alertdialog" aria-label="Start this family over?">
            Delete everything recorded for {brief.household}?
            <button className="adv-reset danger" onClick={reset} autoFocus>
              Yes, start over
            </button>
            <button className="adv-reset" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="adv-reset"
            onClick={() => {
              setResetNote(null);
              setConfirming(true);
            }}
          >
            Reset
          </button>
        )}
      </header>
      {error ? <p className="error">{error}</p> : null}
      {resetNote ? (
        <p className="adv-note" role="status">
          {resetNote}
        </p>
      ) : null}

      {!brief.lastActivity ? (
        <Empty />
      ) : (
        <>
          <section className="adv-agenda" aria-label="Suggested agenda">
            {brief.agenda.length ? (
              <AgendaRow items={brief.agenda} names={brief.people} />
            ) : (
              <>
                <h2>Suggested agenda</h2>
                <p className="muted">Nothing open yet: no unresolved "I'm lost", no differences between partners, no questions.</p>
              </>
            )}
            <p className="adv-skip">
              {brief.alreadyUnderstood.length
                ? `Already understood: ${brief.alreadyUnderstood.length} idea${brief.alreadyUnderstood.length === 1 ? "" : "s"} you can skip (${brief.alreadyUnderstood.map((t) => t.title).join(", ")}).`
                : "No ideas marked as understood yet."}
            </p>
          </section>

          <div className="adv-grid" style={{ gridTemplateColumns: `repeat(${columns.length + (brief.couple ? 1 : 0)}, minmax(0, 1fr))` }}>
            {columns.map((p) => (
              <PersonColumn key={p.memberId} p={p} />
            ))}
            {brief.couple ? <CoupleColumn c={brief.couple} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function Empty() {
  return (
    <section className="adv-empty">
      <h2>Nothing yet</h2>
      <p>As the family reads their plan on their phones, this page fills in by itself:</p>
      <ul>
        <li>the ideas each person understood, so you can skip them,</li>
        <li>where they said "I'm lost", and which explanation finally worked,</li>
        <li>what they wanted to know more about, and the questions they sent you,</li>
        <li>the first step each one picked, and for a couple, where they agree and differ.</li>
      </ul>
      <p className="muted">Only what each person chooses to share. Someone who hasn't chosen shows as "has not shared yet".</p>
    </section>
  );
}

function evidenceLine(evidence: Evidence[], names: PersonBrief[]): string {
  const name = (id: string) => names.find((p) => p.memberId === id)?.name ?? id;
  const what: Record<string, string> = { reaction: "reaction", ranking: "ranking", question: "question" };
  const counts = new Map<string, number>();
  for (const e of evidence) {
    const k = `${what[e.type] ?? e.type} by ${name(e.member)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const latest = evidence.map((e) => e.at).sort().at(-1);
  return `From ${[...counts].map(([k, n]) => `${n} ${n === 1 ? k : k.replace(/^(\w+)/, "$1s")}`).join(", ")}${latest ? `, latest ${time(latest)}` : ""}`;
}

function Predicted({ t }: { t: Tension }) {
  return (
    <p className="adv-predicted">
      <strong>Persona predicted this</strong> · {t.id} ({t.severity.toLowerCase()}): {t.summary}
    </p>
  );
}

/**
 * Every agenda item, most important first, in one row that slides sideways: three fit on a laptop,
 * the rest are a swipe (or the arrows) away, so a long list never pushes the people off the screen.
 */
function AgendaRow({ items, names }: { items: AgendaItem[]; names: PersonBrief[] }) {
  const row = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  // Re-measure when items arrive (every 2 s) or the window changes size.
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, items.length]);

  const slide = (dir: 1 | -1) => {
    const el = row.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 12), behavior: "smooth" });
  };

  return (
    <>
      <div className="adv-agenda-head">
        <h2>
          Suggested agenda <span className="adv-count">{items.length}</span>
        </h2>
        {!(edges.start && edges.end) ? (
          <div className="adv-arrows">
            <button className="adv-arrow" onClick={() => slide(-1)} disabled={edges.start} aria-label="Previous agenda items">
              ‹
            </button>
            <button className="adv-arrow" onClick={() => slide(1)} disabled={edges.end} aria-label="Next agenda items">
              ›
            </button>
          </div>
        ) : null}
      </div>
      <ol ref={row} className="adv-agenda-row" onScroll={measure} tabIndex={0} aria-label={`${items.length} agenda items, slide sideways for more`}>
        {items.map((a, i) => (
          <AgendaCard key={`${a.kind}-${a.title}-${a.evidence[0]?.at ?? i}`} item={a} n={i + 1} names={names} />
        ))}
      </ol>
    </>
  );
}

function AgendaCard({ item, n, names }: { item: AgendaItem; n: number; names: PersonBrief[] }) {
  return (
    <li className={`adv-item adv-${item.kind}`}>
      <span className="adv-n" aria-hidden="true">
        {n}
      </span>
      <div>
        <h3>{item.title}</h3>
        <p>{item.detail}</p>
        {item.personaPredicted ? <Predicted t={item.personaPredicted} /> : null}
        <p className="adv-evidence">{evidenceLine(item.evidence, names)}</p>
      </div>
    </li>
  );
}

function Stuck({ s }: { s: StuckTopic }) {
  const times = s.lostCount === 1 ? "lost once" : `lost ${s.lostCount} times`;
  const outcome = !s.resolved ? "still lost" : s.landed ? `landed with ${LANDED[s.landed] ?? s.landed}` : "moved on";
  return (
    <li className={s.resolved ? "" : "open"}>
      <strong>{s.title}</strong> · {times} · {outcome}
    </li>
  );
}

function PersonColumn({ p }: { p: PersonBrief }) {
  return (
    <section className="adv-col" aria-label={p.name}>
      <h2>
        {p.name}
        <span className={`adv-chip ${p.shared ? "on" : ""}`}>{p.shared ? "Shared" : "Has not shared yet"}</span>
      </h2>
      {p.shared ? (
        <>
          <Block title="Got lost on" empty="Nowhere">
            {p.stuck.length ? <ul>{p.stuck.map((s) => <Stuck key={s.topicId} s={s} />)}</ul> : null}
          </Block>
          <Block title="Wanted more on" empty="Nothing">
            {p.wantedDepth.length ? <p>{p.wantedDepth.map((t) => t.title).join(", ")}</p> : null}
          </Block>
          <Block title="Understood" empty="Nothing marked yet">
            {p.understood.length ? (
              <p title={p.understood.map((t) => t.title).join(", ")}>
                {p.understood.length} idea{p.understood.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </Block>
          {p.skipped.length || p.notReached.length ? (
            <p className="adv-small">
              {p.skipped.length ? `Skipped: ${p.skipped.map((t) => t.title).join(", ")}. ` : ""}
              {p.notReached.length ? `Not reached yet: ${p.notReached.length} idea${p.notReached.length === 1 ? "" : "s"}.` : ""}
            </p>
          ) : null}
          <Block title="First step" empty="Not chosen yet">
            {p.firstStep ? (
              <p>
                <strong>{p.firstStep.label}</strong> · by {day(p.firstStep.dueDate)}
                {p.checkin ? ` · check-in: ${p.checkin.status === "done" ? "done" : "not yet"}` : ""}
              </p>
            ) : null}
          </Block>
        </>
      ) : null}
      <Block title="Questions for you" empty={p.shared ? "None" : null}>
        {p.questions.length ? (
          <ul className="adv-questions">
            {p.questions.map((q) => (
              <li key={q.at}>
                “{q.text}” <span className="adv-small">· on {q.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Block>
    </section>
  );
}

function CoupleColumn({ c }: { c: CoupleBrief }) {
  return (
    <section className="adv-col adv-couple" aria-label="The couple">
      <h2>Their priorities</h2>
      {c.status === "not_shared" ? (
        <p className="muted">Shown once both partners choose to share.</p>
      ) : c.status === "waiting" ? (
        <p className="muted">Waiting for {c.waitingFor.join(" and ")} to order the priorities.</p>
      ) : (
        <>
          <Block title="They agree on" empty="No priority in both top twos">
            {c.agreeOn.length ? (
              <ul>
                {c.agreeOn.map((x) => (
                  <li key={x.index}>
                    <strong>{x.label}</strong>
                    <span className="adv-plan">The plan: {x.planSays}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Block>
          <Block title="They see differently" empty="No priority three or more places apart">
            {c.seeDifferently.length ? (
              <ul>
                {c.seeDifferently.map((x) => (
                  <li key={x.index} className="open">
                    <strong>{x.label}</strong> · {x.ranks.map((r) => `${r.name} #${r.rank}`).join(", ")}
                    <span className="adv-plan">The plan: {x.planSays}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Block>
        </>
      )}
    </section>
  );
}

function Block({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  if (!children && empty === null) return null;
  // Empty sections take one line, so a typical family fits on one screen.
  if (!children)
    return (
      <p className="adv-block adv-line">
        <span>{title}</span> <span className="adv-none">{empty}</span>
      </p>
    );
  return (
    <div className="adv-block">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
