// After the capsules: the couple's agreement point, one first step with a commitment, and the
// simulated Day 3 check-in. Priorities are the plan's own recommendations; the order is theirs.
import { useEffect, useState } from "react";
import { api, type Capsule, type CaseSummary } from "../api.ts";
import { futureApi, type Agreement, type FirstStep, type Priority } from "../api-future.ts";
import { CapsuleCard } from "./CapsuleCard.tsx";
import { Bubble, useFutureSelves } from "./FutureSelf.tsx";

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const together = (member: string) => member === "together";

function useFirstStep(caseId: string, member: string) {
  const [data, setData] = useState<FirstStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    futureApi.firstStep(caseId, member).then(setData, (e: Error) => setError(e.message));
  }, [caseId, member]);
  return { data, error };
}

/** What the plan says a priority does to the score, in words (no numbers that aren't the plan's). */
function ScoreLine({ p }: { p: Priority }) {
  if (!p.score) return null;
  const { before, after, liftsACap, combo } = p.score;
  return (
    <div className="score-lines">
      {after > before ? (
        <p className="step-facts-line">
          Your score: {before} → <strong>{after}</strong>
        </p>
      ) : liftsACap ? (
        <p className="step-note">On its own your score stays at {before}, but this removes one of the limits holding it down.</p>
      ) : (
        <p className="step-note">On its own it doesn't change your score of {before}.</p>
      )}
      {combo ? (
        <p className="step-note">
          Together with {combo.with.join(" and ")}, your plan puts the score at <strong>{combo.after}</strong>.
        </p>
      ) : null}
    </div>
  );
}

// ---- couple: each partner orders the plan's priorities ---------------------------------------

export function AgreementScreen({ household, onDone }: { household: CaseSummary; onDone: () => void }) {
  const { data, error } = useFirstStep(household.id, "together");
  const [agreed, setAgreed] = useState<Agreement | null>(null);
  const [turn, setTurn] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const partners = household.members;

  useEffect(() => {
    futureApi.agreement(household.id).then(setAgreed, (e: Error) => setProblem(e.message));
  }, [household.id]);

  if (error || problem) return <p className="error">{error ?? problem}</p>;
  if (!data || !agreed) return <p className="muted">Loading…</p>;

  if (agreed.status === "ready")
    return (
      <section className="agreement">
        <h1>Where you agree</h1>
        <p className="lede">{agreed.summary}</p>
        <ol className="agree-list">
          {agreed.items.map((it) => (
            <li key={it.index} className={agreed.agreeOn.includes(it.index) ? "agree" : agreed.seeDifferently.includes(it.index) ? "differ" : ""}>
              <span className="agree-label">{it.label}</span>
              <span className="agree-ranks">
                {partners.map((m) => (
                  <span key={m.id} className="rank-chip" title={`${m.name} put it #${it.ranks[m.id]}`}>
                    {m.name[0]} #{it.ranks[m.id]}
                  </span>
                ))}
              </span>
              {agreed.seeDifferently.includes(it.index) ? <span className="plan-quote">Your plan: “{it.text}”</span> : null}
            </li>
          ))}
        </ol>
        <p className="step-note">{agreed.note}</p>
        <button className="primary wide" onClick={onDone}>
          Choose our first step
        </button>
        <button
          className="link"
          onClick={() => {
            setAgreed({ ...agreed, status: "waiting", waitingFor: partners.map((m) => m.id) });
            setTurn(0);
            setOrder([]);
          }}
        >
          Order them again
        </button>
      </section>
    );

  const who = partners[turn]!;
  const tap = (i: number) => setOrder((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));
  const save = async () => {
    try {
      await futureApi.rank(household.id, who.id, order);
      setOrder([]);
      if (turn + 1 < partners.length) setTurn(turn + 1);
      else setAgreed(await futureApi.agreement(household.id));
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  return (
    <section className="agreement">
      <p className="kicker">{turn === 0 ? "One thing to decide together" : `Now pass the phone to ${who.name}`}</p>
      <h1>{who.name}, what comes first for you?</h1>
      <p className="lede">These all compete for the same money. Tap them in your order. {turn > 0 ? `You won't see ${partners[0]!.name}'s answers yet.` : ""}</p>
      <ul className="rank-list">
        {data.priorities.map((p) => {
          const pos = order.indexOf(p.index);
          return (
            <li key={p.index}>
              <button className={`rank-option ${pos >= 0 ? "on" : ""}`} onClick={() => tap(p.index)} aria-pressed={pos >= 0}>
                <span className="rank-num" aria-hidden="true">
                  {pos >= 0 ? pos + 1 : ""}
                </span>
                <span>
                  <strong>{p.label}</strong>
                  <span className="muted rank-text">{p.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="primary wide" onClick={save} disabled={order.length !== data.priorities.length}>
        {order.length === data.priorities.length ? "Save my order" : `Tap ${data.priorities.length - order.length} more`}
      </button>
      {order.length ? (
        <button className="link" onClick={() => setOrder([])}>
          Start again
        </button>
      ) : null}
      <p className="source">From your plan · Recommendations. The plan lists them in its own order, not as a ranking.</p>
    </section>
  );
}

// ---- one first step + commitment -------------------------------------------------------------

export function FirstStepScreen({ household, member, onCommitted }: { household: CaseSummary; member: string; onCommitted: () => void }) {
  const { data, error: loadError } = useFirstStep(household.id, member);
  const [chosen, setChosen] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [due, setDue] = useState(inDays(7));
  const [error, setError] = useState<string | null>(null);
  const { selves } = useFutureSelves(household.id, member);
  const self = selves?.[0];

  if (loadError || error) return <p className="error">{loadError ?? error}</p>;
  if (!data || !selves) return <p className="muted">Loading…</p>;
  const current = chosen ?? data.commitment?.priorityIndex ?? data.suggested;
  const p = data.priorities.find((x) => x.index === current) ?? data.priorities[0];
  if (!p) return <p className="lede">Your plan doesn't list a first step yet: your advisor can help you choose one.</p>;
  const isSuggested = p.index === data.suggested;

  const lead = data.commitment
    ? `You already picked this one, for ${prettyDate(data.commitment.dueDate)}. Keep it, or choose another.`
    : data.suggestedBecause === "agreement"
      ? "This is the one you put highest together. Want to start here this week?"
      : "That's the whole plan. If you do one thing this week, here's the one your plan puts first.";
  const kicker = !isSuggested
    ? "The step you chose"
    : data.suggestedBecause === "agreement"
      ? "Your shared first step"
      : "Your plan's first priority";

  const commit = async () => {
    try {
      await futureApi.commit(household.id, member, p.index, due);
      onCommitted();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="first-step">
      {self ? <Bubble name={self.name}>{lead}</Bubble> : null}
      <article className="step-card">
        <p className="kicker">{kicker}</p>
        <h2>{p.label}</h2>
        <p className="step-action">
          <span className="plan-says">Your plan: </span>
          {p.text}
        </p>
        <ScoreLine p={p} />
        <p className="source">From your plan · Recommendations</p>
      </article>

      <div className="other-steps">
        <button className="link" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
          {picking ? "Keep this one" : "Choose another: the order is yours"}
        </button>
        {picking ? (
          <ul>
            {data.priorities.map((x) => (
              <li key={x.index}>
                <button className={`step-option ${x.index === p.index ? "on" : ""}`} onClick={() => setChosen(x.index)} aria-pressed={x.index === p.index}>
                  <span>{x.label}</span>
                  {x.score && x.score.after > x.score.before ? (
                    <span className="muted">
                      Score {x.score.before} → {x.score.after}
                    </span>
                  ) : x.score?.combo ? (
                    <span className="muted">
                      Score {x.score.combo.after} with {x.score.combo.with.length === 1 ? "one more step" : "two more steps"}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="commit">
        <label htmlFor="due">{together(member) ? "We'll do it by…" : "I'll do it by…"}</label>
        <input id="due" type="date" value={due} min={inDays(0)} max={inDays(365)} onChange={(e) => setDue(e.target.value)} />
        <button className="primary wide" onClick={commit} disabled={!due}>
          {together(member) ? "We'll" : "I'll"} do it by {due ? prettyDate(due) : "…"}
        </button>
      </div>
    </section>
  );
}

// ---- a question for the advisor -----------------------------------------------------------------

export function AskAdvisor({ caseId, member, topicId }: { caseId: string; member: string; topicId: string }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sent) return <p className="sent-note">✓ Sent to your advisor. They'll see it before you next talk.</p>;
  return (
    <form
      className="ask"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await futureApi.ask(caseId, member, topicId, text);
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label htmlFor={`ask-${topicId}`}>Still not clear? Ask your advisor</label>
      <textarea id={`ask-${topicId}`} rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question…" />
      {error ? <p className="error">{error}</p> : null}
      <button className="ghost" type="submit" disabled={text.trim().length < 3}>
        Send to my advisor
      </button>
    </form>
  );
}

// ---- check-ins (simulated for the demo) ---------------------------------------------------------

export function CheckInScreen({ household, member, onRestart }: { household: CaseSummary; member: string; onRestart: () => void }) {
  const { data, error: loadError } = useFirstStep(household.id, member);
  const [answer, setAnswer] = useState<"done" | "not_yet" | null>(null);
  const [explain, setExplain] = useState<Capsule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selves } = useFutureSelves(household.id, member);
  const self = selves?.[0];
  const names = together(member) ? household.members.map((m) => m.name).join(" and ") : self?.name;

  const reply = async (status: "done" | "not_yet") => {
    try {
      const r = await futureApi.checkin(household.id, member, status);
      setAnswer(status);
      if (r.next) setExplain(await futureApi.capsule(household.id, r.next.topicId, r.next.level, member, r.next.attempt));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loadError || error) return <p className="error">{loadError ?? error}</p>;
  if (!data || !self) return <p className="muted">Loading…</p>;
  const c = data.commitment;
  const step = c ? (data.priorities.find((p) => p.index === c.priorityIndex)?.label ?? c.label) : "";
  const youDid = together(member) ? "you two said you'd" : "you said you'd";

  return (
    <section className="checkins">
      <p className="sim-chip">Simulated · Day 3</p>
      {c ? (
        <>
          <Bubble name={self.name}>
            Hey {names}. {youDid.charAt(0).toUpperCase() + youDid.slice(1)} do this by {prettyDate(c.dueDate)}: <strong>{step.toLowerCase()}</strong>. Did you do it?
          </Bubble>
          {answer === null ? (
            <div className="reply-row">
              <button className="primary" onClick={() => reply("done")}>
                Done
              </button>
              <button className="ghost" onClick={() => reply("not_yet")}>
                Not yet, I have a question
              </button>
            </div>
          ) : null}
          {answer === "done" ? (
            <>
              <Bubble name={self.name} tone="me">
                Done
              </Bubble>
              <Bubble name={self.name}>
                {self.reason === "savings_run_out"
                  ? `That's one real step toward making our savings last past ${self.age}. I'll check in again before the next big date.`
                  : `That's one real step closer to ${self.age}. I'll check in again before the next big date.`}
              </Bubble>
            </>
          ) : null}
          {answer === "not_yet" ? (
            <>
              <Bubble name={self.name} tone="me">
                Not yet, I have a question
              </Bubble>
              <Bubble name={self.name}>No problem. Here it is again, another way. If it still isn't clear, ask your advisor below.</Bubble>
              {explain ? (
                <>
                  <CapsuleCard
                    capsule={explain}
                    step={0}
                    total={0}
                    onListen={() => api.audio(household.id, { topicId: explain.topicId, level: explain.level, member, attempt: 0 })}
                  />
                  <AskAdvisor caseId={household.id} member={member} topicId={explain.topicId} />
                </>
              ) : (
                <p className="muted">Loading…</p>
              )}
            </>
          ) : null}
        </>
      ) : (
        <Bubble name={self.name}>Pick your first step and I'll check in with you.</Bubble>
      )}

      {self.checkIns.length ? (
        <div className="upcoming">
          <h2>When I'll check in next</h2>
          <ul>
            {self.checkIns.map((m) => (
              <li key={`${m.date}-${m.label}`}>{m.checkInLabel}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button className="link" onClick={onRestart}>
        Back to start
      </button>
    </section>
  );
}
