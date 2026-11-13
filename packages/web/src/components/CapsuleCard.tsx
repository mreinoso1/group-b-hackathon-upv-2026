import { useEffect, useRef, useState } from "react";
import type { AudioAnswer, Capsule, Reaction } from "../api.ts";
import { Chart } from "../charts/Chart.tsx";
import { figure, PIECE_LABEL } from "../format.ts";

/** Renders **bold** from the plan's text as <strong>; everything else stays plain text (no HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

const STYLE_TAG: Record<string, string> = { analogy: "Said another way", steps: "Step by step", one_number: "The one number that matters" };

function levelTag(c: Capsule): string | null {
  if (c.level === "expert") return "The full detail";
  if (c.level === "simple") return c.generatedBy === "llm" ? STYLE_TAG[c.style ?? ""] ?? "Said another way" : "Said more simply";
  return null;
}

export function CapsuleCard({ capsule, step, total, onListen }: { capsule: Capsule; step: number; total: number; onListen: () => Promise<AudioAnswer> }) {
  const [showPlanWords, setShowPlanWords] = useState(false);
  const tag = levelTag(capsule);
  return (
    <article className={`capsule level-${capsule.level}`} aria-live="polite">
      <header className="capsule-head">
        <span className={`piece piece-${capsule.piece}`}>{PIECE_LABEL[capsule.piece]}</span>
        <span className="step">
          {step} of {total} · ~{capsule.estSeconds}s
        </span>
      </header>
      <h2>{capsule.title}</h2>
      {tag ? <p className="level-tag">{tag}</p> : null}
      <ListenButton onListen={onListen} />

      {capsule.chart ? <Chart spec={capsule.chart} simple={capsule.level === "simple"} /> : null}

      <div className="blocks">
        {capsule.blocks.map((b, i) => (
          <p key={i}>
            <RichText text={b.text} />
          </p>
        ))}
      </div>

      {capsule.generatedBy === "llm" ? (
        <p className="checked">
          <span aria-hidden="true">✓</span> Every number here was checked against your plan.
        </p>
      ) : null}

      {capsule.level === "simple" && capsule.planWords.length > 0 ? (
        <div className="plan-words">
          <button className="link" onClick={() => setShowPlanWords((v) => !v)} aria-expanded={showPlanWords}>
            {showPlanWords ? "Hide" : "Show"} your plan's own words
          </button>
          {showPlanWords ? capsule.planWords.map((b, i) => <p key={i}><RichText text={b.text} /></p>) : null}
        </div>
      ) : null}

      {capsule.level === "expert" && capsule.figures.length > 0 ? (
        <table className="figures">
          <caption>The numbers, and where to find them in your plan</caption>
          <tbody>
            {capsule.figures.map((f) => (
              <tr key={f.source + f.label} data-source={f.source}>
                <th scope="row">
                  {f.label}
                  {f.section ? <span className="figure-section">{f.section}</span> : null}
                </th>
                <td>{figure(f.value, f.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {capsule.missing.length > 0 ? (
        <p className="missing">Some of this is not in your plan data yet, so we leave it out rather than guess.</p>
      ) : null}
    </article>
  );
}

/**
 * Plays the capsule: a cached recording when there is one, otherwise the device's own voice.
 * Nothing plays until the person taps.
 */
function ListenButton({ onListen }: { onListen: () => Promise<AudioAnswer> }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const stop = () => {
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    setState("idle");
  };

  const play = async () => {
    if (state === "playing") return stop();
    setState("loading");
    try {
      const answer = await onListen();
      if (answer.kind === "audio") {
        const el = new Audio(answer.url);
        audio.current = el;
        el.onended = () => setState("idle");
        await el.play();
      } else if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(answer.text);
        u.lang = "en-US";
        u.onend = () => setState("idle");
        window.speechSynthesis.speak(u);
      } else {
        setState("idle");
        return;
      }
      setState("playing");
    } catch {
      setState("idle");
    }
  };

  return (
    <button className="play" onClick={play} aria-pressed={state === "playing"}>
      <span className="play-icon" aria-hidden="true">
        {state === "playing" ? "■" : "▶"}
      </span>
      {state === "loading" ? "Getting the audio…" : state === "playing" ? "Stop" : "Listen"}
    </button>
  );
}

const REACTION_UI: Record<Reaction, { label: string; hint: string }> = {
  got_it: { label: "Got it", hint: "Next idea" },
  lost: { label: "I'm lost", hint: "Explain it another way" },
  tell_me_more: { label: "Tell me more", hint: "Show the real numbers" },
};

export function ReactionBar({ onReact, busy }: { onReact: (r: Reaction) => void; busy: boolean }) {
  return (
    <nav className="reactions" aria-label="How did that land?">
      {(["lost", "got_it", "tell_me_more"] as const).map((r) => (
        <button key={r} className={`reaction reaction-${r}`} disabled={busy} onClick={() => onReact(r)}>
          <span className="r-label">{REACTION_UI[r].label}</span>
          <span className="r-hint">{REACTION_UI[r].hint}</span>
        </button>
      ))}
    </nav>
  );
}
