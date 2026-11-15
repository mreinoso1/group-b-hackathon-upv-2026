import { useCallback, useEffect, useState } from "react";
import type { AgendaItem, CoupleBrief, Evidence, PersonBrief, StuckTopic, Tension } from "@bite/plan-core";
import { advisorApi, type AdvisorBrief } from "../api-advisor.ts";
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

  const reset = async () => {
    if (!window.confirm(`Delete everything recorded for ${brief?.household ?? "this family"}? This starts the demo over and cannot be undone.`)) return;
    await advisorApi.reset(caseId);
    await load();
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
        <p className="adv-score">
          Financial Health Score <strong>{brief.score}</strong> · {brief.band}
        </p>
        <p className="adv-live" aria-live="polite">
          <span className="adv-dot" aria-hidden="true" />
          {brief.lastActivity ? `Live · last activity ${time(brief.lastActivity)}` : "Live · waiting for the family"}
        </p>
        <button className="adv-reset" onClick={reset}>
          Reset
        </button>
      </header>
      {error ? <p className="error">{error}</p> : null}

      {!brief.lastActivity ? (
        <Empty />
      ) : (
        <>
          <section className="adv-agenda" aria-label="Suggested agenda">
            <h2>Suggested agenda</h2>
            {brief.agenda.length ? (
              <ol>
                {brief.agenda.map((a, i) => (
                  <AgendaCard key={i} item={a} n={i + 1} names={brief.people} />
                ))}
              </ol>
            ) : (
              <p className="muted">Nothing open yet: no unresolved "I'm lost", no differences between partners, no questions.</p>
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
