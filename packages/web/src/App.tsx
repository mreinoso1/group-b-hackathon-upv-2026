import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Capsule, type CaseSummary, type Level, type Reaction, type TopicInfo } from "./api.ts";
import { joinTarget, ROOM } from "./room.ts";
import { CapsuleCard, ReactionBar } from "./components/CapsuleCard.tsx";
import { ConsentScreen } from "./components/Consent.tsx";
import { Bubble, FutureSelfIntro, MeetFutureSelf, PortraitContext, portraitsFor } from "./components/FutureSelf.tsx";
import { CasePeak, Climb, GuideBot, GuideStage, useGuideSays } from "./components/Guide.tsx";
import { AgreementScreen, AskAdvisor, CheckInScreen, FirstStepScreen } from "./components/Steps.tsx";

type Step = "intro" | "consent" | "feed" | "agree" | "step" | "meet" | "checkin";
type Screen = { name: "cases" } | { name: "who"; household: CaseSummary } | { name: Step; household: CaseSummary; member: string };

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
        if (cancelled) return;
        setCases(r.cases);
        // A join link (a QR on the demo page) opens straight at that person's start.
        const join = joinTarget(window.location.pathname, window.location.search);
        const household = join && r.cases.find((c) => c.id === join.caseId);
        const member = household && (join.member === "together" ? "together" : household.members.find((m) => m.id === join.member)?.id);
        if (household && member) setScreen({ name: "intro", household, member });
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
    if (household.members.length === 1) setScreen({ name: "intro", household, member: household.members[0]!.id });
    else setScreen({ name: "who", household });
  };

  return (
    <div className="app">
      <header className="top">
        <button
          className="brand"
          onClick={() => {
            // Leave a join link's address too, so a reload doesn't jump back into that person; the room stays.
            window.history.replaceState(null, "", ROOM ? `/?room=${ROOM}` : "/");
            setScreen({ name: "cases" });
          }}
          aria-label="Back to start"
        >
          Future You<span className="brand-dot">.</span>
        </button>
        {screen.name !== "cases" ? <span className="who-chip">{whoLabel(screen)}</span> : null}
        {ROOM ? <span className="room-chip" title="Demo room: what you tap stays in this room">Room {ROOM}</span> : null}
      </header>

      {/* Keyed by screen: each new screen enters with a short fade-up. */}
      <PortraitContext.Provider value={screen.name === "cases" ? {} : portraitsFor(screen.household)}>
      <main key={screen.name === "cases" ? "cases" : `${screen.name}-${screen.household.id}`} className="screen">
        {error ? <p className="error">{error}</p> : null}
        {screen.name === "cases" ? <CasePicker cases={cases} onPick={pickCase} /> : null}
        {screen.name === "who" ? <WhoPicker household={screen.household} onPick={(member) => setScreen({ name: "intro", household: screen.household, member })} /> : null}
        {screen.name === "consent" ? <ConsentScreen household={screen.household} member={screen.member} onDone={() => setScreen({ ...screen, name: "feed" })} /> : null}
        {screen.name === "intro" ? (
          <FutureSelfIntro household={screen.household} member={screen.member} onStart={() => setScreen({ ...screen, name: "consent" })} />
        ) : null}
        {screen.name === "feed" ? (
          <Feed
            household={screen.household}
            member={screen.member}
            // A couple reading together first finds where they agree; everyone else goes to the step.
            onDone={() => setScreen({ ...screen, name: screen.member === "together" && screen.household.members.length > 1 ? "agree" : "step" })}
          />
        ) : null}
        {screen.name === "agree" ? <AgreementScreen household={screen.household} onDone={() => setScreen({ ...screen, name: "step" })} /> : null}
        {screen.name === "step" ? (
          <FirstStepScreen household={screen.household} member={screen.member} onCommitted={() => setScreen({ ...screen, name: "meet" })} />
        ) : null}
        {screen.name === "meet" ? <MeetFutureSelf household={screen.household} member={screen.member} onDone={() => setScreen({ ...screen, name: "checkin" })} /> : null}
        {screen.name === "checkin" ? <CheckInScreen household={screen.household} member={screen.member} onRestart={() => setScreen({ name: "cases" })} /> : null}
      </main>
      </PortraitContext.Provider>
    </div>
  );
}

function whoLabel(screen: Exclude<Screen, { name: "cases" }>): string {
  if (screen.name === "who") return screen.household.label;
  const m = screen.household.members.find((x) => x.id === screen.member);
  return m ? `${m.name}'s plan` : `${screen.household.label}, together`;
}

const HOME_LINE = "Hi! I'm Summit. Pick a family and I'll walk you through their plan, one idea at a time.";

function Pin() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="10" r="2.6" fill="currentColor" />
    </svg>
  );
}

function Kids() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2.5 20c.6-3.6 2.8-5.5 5.5-5.5s4.9 1.9 5.5 5.5M13.5 20c.4-2.6 1.8-4 3.5-4s3.1 1.4 3.5 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CasePicker({ cases, onPick }: { cases: CaseSummary[] | null; onPick: (c: CaseSummary) => void }) {
  const talking = useGuideSays(HOME_LINE, true);
  return (
    <section className="intro home">
      <div className="home-hero">
        <GuideStage compact>
          <GuideBot size={96} waving talking={talking} />
        </GuideStage>
        <p className="bubble self guide-line home-bubble">{HOME_LINE}</p>
        <p className="demo-note">Demo · four example families</p>
      </div>
      {!cases ? <p className="muted">Loading families…</p> : null}
      <ul className="case-list">
        {cases?.map((c, i) => (
          <li key={c.id}>
            <button className={`case family-${i % 4}`} onClick={() => onPick(c)}>
              <CasePeak score={c.score} />
              <span className="case-text">
                <span className="case-name">{c.label}</span>
                <span className="case-meta">
                  <Pin /> {c.city}, {c.state}
                </span>
                {c.children.length ? (
                  <span className="case-meta">
                    <Kids /> {c.children.map((k) => k.name).join(" & ")}
                  </span>
                ) : null}
              </span>
              <span className="case-side">
                <span className={`score-badge band-${c.band}`}>
                  <strong>{c.score}</strong>
                  <small>score</small>
                </span>
                <span className="case-go" aria-hidden="true">
                  ›
                </span>
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
    api.topics(household.id, member).then(
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
  }, [household.id, member]);

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
          // While they read, the server prepares "I'm lost" (returns at once). "Listen" needs no
          // prefetch: the voice streams and starts within a second or two.
          if (c.level === "standard") void api.prefetchCapsule(household.id, c.topicId, "simple", member, 0);
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
        const r = await api.react(household.id, {
          member,
          topicId: capsule.topicId,
          level: capsule.level,
          reaction,
          dwellMs: Date.now() - shownAt.current,
          // Which re-explanation this answers, so the advisor sees what finally landed.
          ...(capsule.level === "simple" ? { attempt: current?.attempt ?? 0 } : {}),
        });
        if (!r.next) onDone();
        else go(r.next);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
        setPending(null);
      }
    },
    [capsule, current, household.id, member, onDone, go],
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
      <Climb step={step} total={topics.length} />
      {pending ? (
        <p className="pending" role="status">
          <span className="spinner" aria-hidden="true" />
          {pending}
        </p>
      ) : null}
      {capsule?.futureSelfLine && capsule.level === "standard" ? (
        <Bubble big name={capsule.futureSelfName ?? speakerName(household, member)}>{capsule.futureSelfLine}</Bubble>
      ) : capsule && capsule.level !== "standard" ? (
        <Bubble big name="guide">
          {capsule.level === "expert" ? "Here are the real numbers, and where each one sits in your plan." : "No problem. Let me put it another way."}
        </Bubble>
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
      {/* After "I'm lost": a way to ask a real question, which goes to the advisor's brief. */}
      {capsule?.level === "simple" ? <AskAdvisor key={`ask-${capsule.id}-${pos}`} caseId={household.id} member={member} topicId={capsule.topicId} /> : null}
      {capsule ? <ReactionBar onReact={react} busy={busy} /> : null}
    </section>
  );
}

/** Who speaks as the future self: the reader, or the first adult when reading together. */
function speakerName(household: CaseSummary, member: string): string {
  return household.members.find((m) => m.id === member)?.name ?? household.members[0]?.name ?? "";
}
