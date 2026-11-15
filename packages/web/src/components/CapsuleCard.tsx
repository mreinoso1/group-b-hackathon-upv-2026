import { useEffect, useRef, useState } from "react";
import type { AudioAnswer, Capsule, Reaction } from "../api.ts";
import { Chart } from "../charts/Chart.tsx";
import { figure, PIECE_LABEL } from "../format.ts";

/** Renders **bold** from the plan's text as <strong>; everything else stays plain text (no HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

const STYLE_TAG: Record<string, string> = { plain: "In plain words", one_number: "The one number that matters", analogy: "Said another way" };

function levelTag(c: Capsule): string | null {
  if (c.level === "expert") return "The full detail";
  if (c.level === "simple") return c.generatedBy === "llm" ? STYLE_TAG[c.style ?? ""] ?? "Said another way" : "Said more simply";
  return null;
}

export function CapsuleCard({ capsule, step, total, onListen }: { capsule: Capsule; step: number; total: number; onListen: () => Promise<AudioAnswer> }) {
  const [showPlanWords, setShowPlanWords] = useState(false);
  const tag = levelTag(capsule);
  const sections = new Set(capsule.figures.map((f) => f.section));
  const oneSection = sections.size === 1 ? capsule.figures[0]?.section : undefined;
  return (
    <article className={`capsule level-${capsule.level}`} aria-live="polite">
      <header className="capsule-head">
        <span className={`piece piece-${capsule.piece}`}>{PIECE_LABEL[capsule.piece]}</span>
        <span className="step">{total > 0 ? `${step} of ${total} · ~${capsule.estSeconds}s` : `~${capsule.estSeconds}s`}</span>
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
          <caption>
            {oneSection ? `The numbers, all from your plan · ${oneSection}` : "The numbers, and where to find them in your plan"}
          </caption>
          <tbody>
            {capsule.figures.map((f) => (
              <tr key={f.source + f.label} data-source={f.source}>
                <th scope="row">
                  {f.label}
                  {f.section && !oneSection ? <span className="figure-section">{f.section}</span> : null}
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
 * Plays raw 16-bit PCM at 24 kHz as it downloads: each chunk is scheduled right after the last,
 * so the voice starts as soon as the first second arrives. Returns a stop function.
 */
function playPcmStream(url: string, onEnd: () => void): () => void {
  const ctx = new AudioContext({ sampleRate: 24000 });
  const controller = new AbortController();
  let next = 0;
  let leftover: number | null = null;
  let finished = false;
  const sources: AudioBufferSourceNode[] = [];

  const end = () => {
    if (finished) return;
    finished = true;
    onEnd();
    void ctx.close().catch(() => undefined);
  };

  void (async () => {
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`audio ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let bytes = value;
        if (leftover !== null) {
          const joined = new Uint8Array(bytes.length + 1);
          joined[0] = leftover;
          joined.set(bytes, 1);
          bytes = joined;
          leftover = null;
        }
        if (bytes.length % 2) leftover = bytes[bytes.length - 1]!;
        const samples = Math.floor(bytes.length / 2);
        if (!samples) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
        const buf = ctx.createBuffer(1, samples, 24000);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 0x8000;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        // A 1.5 s cushion at the start: the voice is generated slightly slower than it plays.
        next = Math.max(next, ctx.currentTime + (next === 0 ? 1.5 : 0.12));
        src.start(next);
        next += buf.duration;
        sources.push(src);
      }
      // Downloaded: end when the last scheduled chunk has played.
      const wait = Math.max(0, next - ctx.currentTime);
      setTimeout(end, wait * 1000 + 100);
    } catch {
      end();
    }
  })();

  return () => {
    controller.abort();
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    end();
  };
}

/** The device's English voice, if it has one. Never a voice in another language reading English. */
async function englishVoice(): Promise<SpeechSynthesisVoice | null> {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  let voices = synth.getVoices();
  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      synth.onvoiceschanged = () => resolve(synth.getVoices());
      setTimeout(() => resolve(synth.getVoices()), 1500);
    });
  }
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.find((v) => v.lang === "en-US" && !v.localService) ?? en.find((v) => v.lang === "en-US") ?? en[0] ?? null;
}

/**
 * Plays the capsule: the server's English recording (generated once, cached). Only if the
 * server can't make one does it use the device's English voice; with none, it says so.
 * Nothing plays until the person taps.
 */
export function ListenButton({ onListen }: { onListen: () => Promise<AudioAnswer> }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "no_voice">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopStream = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      stopStream.current?.();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const stop = () => {
    audio.current?.pause();
    stopStream.current?.();
    stopStream.current = null;
    window.speechSynthesis?.cancel();
    setState("idle");
  };

  const play = async () => {
    if (state === "playing") return stop();
    setState("loading");
    try {
      const answer = await onListen();
      if (answer.kind === "stream") {
        stopStream.current = playPcmStream(answer.url, () => setState("idle"));
      } else if (answer.kind === "audio") {
        const el = new Audio(answer.url);
        audio.current = el;
        el.onended = () => setState("idle");
        await el.play();
      } else {
        const voice = await englishVoice();
        if (!voice) {
          setState("no_voice");
          return;
        }
        const u = new SpeechSynthesisUtterance(answer.text);
        u.voice = voice;
        u.lang = voice.lang;
        u.onend = () => setState("idle");
        window.speechSynthesis.speak(u);
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
      {state === "loading" ? "Getting the audio…" : state === "playing" ? "Stop" : state === "no_voice" ? "Audio not available right now" : "Listen"}
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
