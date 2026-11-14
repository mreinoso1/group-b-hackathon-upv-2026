// The future self: who greets each person, speaks before each idea, proposes the first step
// and comes back to check in. Every number shown comes from the plan via plan-coach.
import { useEffect, useState } from "react";
import { api, type Capsule, type CaseSummary } from "../api.ts";
import { futureApi, type FirstStep, type FutureSelfView } from "../api-future.ts";
import { CapsuleCard, ListenButton } from "./CapsuleCard.tsx";

const initials = (name: string) =>
  name
    .split(/\s|&/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

/** A chat-style message from the future self. */
export function Bubble({ name, children, tone = "self" }: { name: string; children: React.ReactNode; tone?: "self" | "me" }) {
  return (
    <div className={`bubble-row ${tone}`}>
      {tone === "self" ? (
        <span className="bubble-avatar" aria-hidden="true">
          {initials(name)}
        </span>
      ) : null}
      <p className={`bubble ${tone}`}>
        {tone === "self" ? <span className="sr-only">{name}'s future self says: </span> : null}
        {children}
      </p>
    </div>
  );
}

// ---- media slot -----------------------------------------------------------------------------

type Media = { kind: "video"; src: string } | { kind: "audio"; src: string; avatar: string | null } | { kind: "none" };

/** The dev server answers unknown paths with index.html, so a file "exists" only with the right type. */
async function exists(url: string, type: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok && (r.headers.get("content-type") ?? "").startsWith(type);
  } catch {
    return false;
  }
}

function useMedia(caseId: string, memberId: string): Media | null {
  const [media, setMedia] = useState<Media | null>(null);
  useEffect(() => {
    let live = true;
    const key = `${caseId}-${memberId}`;
    void (async () => {
      let m: Media = { kind: "none" };
      if (await exists(`/video/${key}.mp4`, "video/")) m = { kind: "video", src: `/video/${key}.mp4` };
      else if (await exists(`/audio/${key}.mp3`, "audio/")) {
        const avatar = (await exists(`/avatars/${key}.png`, "image/")) ? `/avatars/${key}.png` : null;
        m = { kind: "audio", src: `/audio/${key}.mp3`, avatar };
      }
      if (live) setMedia(m);
    })();
    return () => {
      live = false;
    };
  }, [caseId, memberId]);
  return media;
}

function MediaSlot({ household, self }: { household: CaseSummary; self: FutureSelfView }) {
  const media = useMedia(household.id, self.memberId);
  if (!media) return <div className="media-slot loading" aria-hidden="true" />;
  if (media.kind === "video")
    return (
      <video className="media-slot" src={media.src} controls playsInline preload="metadata">
        <track kind="captions" />
      </video>
    );
  if (media.kind === "audio")
    return (
      <div className="media-slot audio">
        {media.avatar ? <img src={media.avatar} alt={`${self.name} at ${self.age}`} /> : <span className="big-avatar">{initials(self.name)}</span>}
        <audio src={media.src} controls preload="none" />
      </div>
    );
  return (
    <div className="media-slot plain">
      <span className="big-avatar" aria-hidden="true">
        {initials(self.name)}
      </span>
      <ListenButton onListen={() => futureApi.introAudio(household.id, self.memberId)} />
    </div>
  );
}

// ---- entry screen -----------------------------------------------------------------------------

export function useFutureSelves(caseId: string, member: string) {
  const [selves, setSelves] = useState<FutureSelfView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    futureApi.futureSelves(caseId, member).then((r) => setSelves(r.futureSelves), (e: Error) => setError(e.message));
  }, [caseId, member]);
  return { selves, error };
}

export function FutureSelfIntro({ household, member, onStart }: { household: CaseSummary; member: string; onStart: () => void }) {
  const { selves, error } = useFutureSelves(household.id, member);
  if (error) return <p className="error">{error}</p>;
  if (!selves) return <p className="muted">Loading…</p>;
  if (!selves.length)
    return (
      <section className="intro">
        <p className="lede">Your plan doesn't give enough to meet your future self yet, so let's go straight to it.</p>
        <button className="primary" onClick={onStart}>
          Show me
        </button>
      </section>
    );
  return (
    <section className="future-intro">
      {selves.map((s) => (
        <article key={s.memberId} className="future-card">
          <h1>
            {s.name}, age {s.age}
          </h1>
          <p className="kicker">Your future self · {s.year}</p>
          <MediaSlot household={household} self={s} />
          <Bubble name={s.name}>{s.introText}</Bubble>
        </article>
      ))}
      <button className="primary wide" onClick={onStart}>
        Show me
      </button>
    </section>
  );
}

// ---- final screen: one first step + commitment ----------------------------------------------------

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function FirstStepScreen({ household, member, onCommitted }: { household: CaseSummary; member: string; onCommitted: () => void }) {
  const [data, setData] = useState<FirstStep | null>(null);
  const [chosen, setChosen] = useState(0);
  const [picking, setPicking] = useState(false);
  const [due, setDue] = useState(inDays(7));
  const [error, setError] = useState<string | null>(null);
  const { selves } = useFutureSelves(household.id, member);
  const self = selves?.[0];

  useEffect(() => {
    futureApi.firstStep(household.id, member).then(
      (r) => {
        setData(r);
        setChosen(r.commitment?.moveIndex ?? r.suggested);
      },
      (e: Error) => setError(e.message),
    );
  }, [household.id, member]);

  if (error) return <p className="error">{error}</p>;
  if (!data || !selves) return <p className="muted">Loading…</p>;
  const move = data.moves.find((m) => m.index === chosen) ?? data.moves[0];
  if (!move) return <p className="lede">Your plan doesn't list a first step yet: your advisor can help you choose one.</p>;
  const best = move.combos[0];

  const commit = async () => {
    try {
      await futureApi.commit(household.id, member, move.index, due);
      onCommitted();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="first-step">
      {self ? <Bubble name={self.name}>That's the whole plan. If you do one thing this week, here's the one the plan puts first.</Bubble> : null}
      <article className="step-card">
        <p className="kicker">{move.index === data.suggested ? "Your plan's first step" : "The step you chose"}</p>
        <h2>{move.title}</h2>
        <p className="step-action">{move.action}</p>
        <dl className="step-facts">
          <div>
            <dt>Effort</dt>
            <dd className="cap">{move.effort}</dd>
          </div>
          <div>
            <dt>Your score</dt>
            <dd>
              {move.scoreBefore} → <strong>{move.scoreAfter}</strong>
            </dd>
          </div>
        </dl>
        {move.liftsACap ? <p className="step-note">It also removes one of the limits holding your score down.</p> : null}
        {best ? (
          <p className="step-note">
            Together with {best.moves.filter((m) => m !== move.title).join(" and ")}, your plan puts the score at <strong>{best.scoreAfter}</strong>.
          </p>
        ) : null}
        <p className="source">From your plan · Financial Health Score</p>
      </article>

      {data.moves.length > 1 ? (
        <div className="other-steps">
          <button className="link" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
            {picking ? "Keep this one" : "Choose another step: the order is yours"}
          </button>
          {picking ? (
            <ul>
              {data.moves.map((m) => (
                <li key={m.index}>
                  <button className={`step-option ${m.index === chosen ? "on" : ""}`} onClick={() => setChosen(m.index)} aria-pressed={m.index === chosen}>
                    <span>{m.title}</span>
                    <span className="muted">
                      {m.scoreBefore} → {m.scoreAfter} · {m.effort} effort
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="commit">
        <label htmlFor="due">I'll do it by…</label>
        <input id="due" type="date" value={due} min={inDays(0)} max={inDays(365)} onChange={(e) => setDue(e.target.value)} />
        <button className="primary wide" onClick={commit} disabled={!due}>
          I'll do it by {due ? prettyDate(due) : "…"}
        </button>
      </div>
    </section>
  );
}

// ---- check-ins (simulated for the demo) ---------------------------------------------------------

export function CheckInScreen({ household, member, onRestart }: { household: CaseSummary; member: string; onRestart: () => void }) {
  const [data, setData] = useState<FirstStep | null>(null);
  const [answer, setAnswer] = useState<"done" | "not_yet" | null>(null);
  const [explain, setExplain] = useState<Capsule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selves } = useFutureSelves(household.id, member);
  const self = selves?.[0];

  useEffect(() => {
    futureApi.firstStep(household.id, member).then(setData, (e: Error) => setError(e.message));
  }, [household.id, member]);

  const reply = async (status: "done" | "not_yet") => {
    try {
      const r = await futureApi.checkin(household.id, member, status);
      setAnswer(status);
      if (r.next) setExplain(await futureApi.capsule(household.id, r.next.topicId, r.next.level, member, r.next.attempt));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!data || !self) return <p className="muted">Loading…</p>;
  const c = data.commitment;

  return (
    <section className="checkins">
      <p className="sim-chip">Simulated · Day 3</p>
      {c ? (
        <>
          <Bubble name={self.name}>
            Hey {self.name}. You said you'd do this by {prettyDate(c.dueDate)}: <strong>{c.moveTitle.toLowerCase()}</strong>. Did you do it?
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
              <Bubble name={self.name}>That's one real step closer to {self.age}. I'll check in again before the next big date.</Bubble>
            </>
          ) : null}
          {answer === "not_yet" ? (
            <>
              <Bubble name={self.name} tone="me">
                Not yet, I have a question
              </Bubble>
              <Bubble name={self.name}>No problem. Here it is again, another way.</Bubble>
              {explain ? (
                <CapsuleCard
                  capsule={explain}
                  step={0}
                  total={0}
                  onListen={() => api.audio(household.id, { topicId: explain.topicId, level: explain.level, member, attempt: 0 })}
                />
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
