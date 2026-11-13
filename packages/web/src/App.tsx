import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Capsule, type CaseSummary, type Level, type Reaction, type TopicInfo } from "./api.ts";
import { CapsuleCard, ReactionBar } from "./components/CapsuleCard.tsx";

type Screen = { name: "cases" } | { name: "who"; household: CaseSummary } | { name: "feed"; household: CaseSummary; member: string } | { name: "done"; household: CaseSummary; member: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "cases" });
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The API may still be starting plan-coach: retry for ~30 s before showing an error.
    let cancelled = false;
    const load = async (attempt: number): Promise<void> => {
      try {
        const r = await api.cases();
        if (!cancelled) setCases(r.cases);
      } catch (e) {
        if (cancelled) return;
        if (attempt < 15) {
          await new Promise((res) => setTimeout(res, 2000));
          return load(attempt + 1);
        }
        setError((e as Error).message);
      }
    };
    void load(0);
    return () => {
      cancelled = true;
    };
  }, []);

  const pickCase = (household: CaseSummary) => {
    if (household.members.length === 1) setScreen({ name: "feed", household, member: household.members[0]!.id });
    else setScreen({ name: "who", household });
  };

  return (
    <div className="app">
      <header className="top">
        <button className="brand" onClick={() => setScreen({ name: "cases" })} aria-label="Back to start">
          one bite<span className="brand-dot">.</span>
        </button>
        {screen.name !== "cases" ? <span className="who-chip">{whoLabel(screen)}</span> : null}
      </header>

      <main>
        {error ? <p className="error">{error}</p> : null}
        {screen.name === "cases" ? <CasePicker cases={cases} onPick={pickCase} /> : null}
        {screen.name === "who" ? <WhoPicker household={screen.household} onPick={(member) => setScreen({ name: "feed", household: screen.household, member })} /> : null}
        {screen.name === "feed" ? (
          <Feed household={screen.household} member={screen.member} onDone={() => setScreen({ name: "done", household: screen.household, member: screen.member })} />
        ) : null}
        {screen.name === "done" ? <Done household={screen.household} onRestart={() => setScreen({ name: "cases" })} /> : null}
      </main>
    </div>
  );
}

function whoLabel(screen: Exclude<Screen, { name: "cases" }>): string {
  if (screen.name === "who") return screen.household.label;
  const m = screen.household.members.find((x) => x.id === screen.member);
  return m ? `${m.name}'s plan` : `${screen.household.label}, together`;
}

function CasePicker({ cases, onPick }: { cases: CaseSummary[] | null; onPick: (c: CaseSummary) => void }) {
  return (
    <section className="intro">
      <h1>Your plan, one bite at a time</h1>
      <p className="lede">One idea a day, in under a minute. Tell us how it landed and we explain it your way.</p>
      {!cases ? <p className="muted">Loading families…</p> : null}
      <ul className="case-list">
        {cases?.map((c) => (
          <li key={c.id}>
            <button className="case" onClick={() => onPick(c)}>
              <span className="case-name">{c.label}</span>
              <span className="muted case-score">Financial Health Score {c.score} · {c.band}</span>
              <span className="muted">
                {c.city}, {c.state}
                {c.children.length ? ` · ${c.children.map((k) => k.name).join(" & ")}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhoPicker({ household, onPick }: { household: CaseSummary; onPick: (member: string) => void }) {
  return (
    <section className="intro">
      <h1>Who's reading?</h1>
      <p className="lede">Each of you gets your own pace. Nothing you tap is shared until you both choose to.</p>
      <div className="who-grid">
        {household.members.map((m) => (
          <button key={m.id} className="who" onClick={() => onPick(m.id)}>
            <span className="avatar" aria-hidden="true">
              {m.name[0]}
            </span>
            {m.name}
          </button>
        ))}
        <button className="who together" onClick={() => onPick("together")}>
          <span className="avatar" aria-hidden="true">
            {household.members.map((m) => m.name[0]).join("")}
          </span>
          Together
        </button>
      </div>
    </section>
  );
}

interface Entry {
  topicId: string;
  level: Level;
  attempt?: number;
}

const PENDING: Record<Reaction, string> = {
  lost: "Finding another way to say it…",
  tell_me_more: "Getting the full detail…",
  got_it: "Next idea…",
};

/**
 * The capsule feed. Every capsule shown is an entry in a small history stack, mirrored in the
 * browser history, so "Back" (button, phone back gesture or browser button) returns to the
 * previous capsule. Going back never records a reaction.
 */
function Feed({ household, member, onDone }: { household: CaseSummary; member: string; onDone: () => void }) {
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [stack, setStack] = useState<Entry[]>([]);
  const [pos, setPos] = useState(0);
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const current = stack[pos] ?? null;

  useEffect(() => {
    api.topics(household.id).then(
      (r) => {
        setTopics(r.topics);
        if (r.topics[0]) {
          setStack([{ topicId: r.topics[0].id, level: "standard" }]);
          setPos(0);
          window.history.replaceState({ bite: 0 }, "");
        }
      },
      (e: Error) => setError(e.message),
    );
  }, [household.id]);

  // Browser / phone back and forward move through the capsules already shown.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const target = (e.state as { bite?: unknown } | null)?.bite;
      setPos(typeof target === "number" ? target : 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setBusy(true);
    api
      .capsule(household.id, current.topicId, current.level, member, current.attempt ?? 0)
      .then(
        (c) => {
          if (cancelled) return;
          setCapsule(c);
          setError(null);
          shownAt.current = Date.now();
          window.scrollTo({ top: 0, behavior: "smooth" });
          // While they read, prepare "I'm lost" so it answers at once (cached server-side, budget-capped).
          if (c.level === "standard") void api.capsule(household.id, c.topicId, "simple", member, 0).catch(() => undefined);
        },
        (e: Error) => !cancelled && setError(e.message),
      )
      .finally(() => {
        if (cancelled) return;
        setBusy(false);
        setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [household.id, member, current]);

  const go = useCallback(
    (next: Entry) => {
      setStack((s) => [...s.slice(0, pos + 1), next]);
      setPos(pos + 1);
      window.history.pushState({ bite: pos + 1 }, "");
    },
    [pos],
  );

  const back = () => {
    if (pos > 0) window.history.back();
  };

  const react = useCallback(
    async (reaction: Reaction) => {
      if (!capsule) return;
      setBusy(true);
      setPending(PENDING[reaction]);
      try {
        const r = await api.react(household.id, { member, topicId: capsule.topicId, level: capsule.level, reaction, dwellMs: Date.now() - shownAt.current });
        if (!r.next) onDone();
        else go(r.next);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
        setPending(null);
      }
    },
    [capsule, household.id, member, onDone, go],
  );

  const step = capsule ? topics.findIndex((t) => t.id === capsule.topicId) + 1 : 0;
  // Topics already reached can be revisited from the progress bar.
  const furthest = Math.max(-1, ...stack.map((e) => topics.findIndex((t) => t.id === e.topicId)));
  return (
    <section className="feed">
      {error ? <p className="error">{error}</p> : null}
      <div className="feed-nav">
        <button className="back" onClick={back} disabled={pos === 0} aria-label="Back to the previous idea">
          <span aria-hidden="true">‹</span> Back
        </button>
        <ol className="progress" aria-label="Your plan, idea by idea">
          {topics.map((t, i) => {
            const state = i + 1 === step ? "here" : i <= furthest ? "done" : "";
            return (
              <li key={t.id} className={state}>
                {i <= furthest && i + 1 !== step ? (
                  <button onClick={() => go({ topicId: t.id, level: "standard" })} aria-label={`Go back to ${t.title}`} title={t.title} />
                ) : (
                  <span title={t.title} aria-current={i + 1 === step ? "step" : undefined} />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {pending ? (
        <p className="pending" role="status">
          <span className="spinner" aria-hidden="true" />
          {pending}
        </p>
      ) : null}
      {capsule ? (
        <CapsuleCard
          key={`${capsule.id}-${pos}`}
          capsule={capsule}
          step={step}
          total={topics.length}
          onListen={() => api.audio(household.id, { topicId: capsule.topicId, level: capsule.level, member, attempt: current?.attempt ?? 0 })}
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
      {capsule ? <ReactionBar onReact={react} busy={busy} /> : null}
    </section>
  );
}

function Done({ household, onRestart }: { household: CaseSummary; onRestart: () => void }) {
  return (
    <section className="intro">
      <h1>That's the whole plan</h1>
      <p className="lede">
        You went through every idea in {household.label}'s plan. Next comes choosing, together, where the spare money goes first.
      </p>
      <button className="primary" onClick={onRestart}>
        Back to start
      </button>
    </section>
  );
}
