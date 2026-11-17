import { useEffect, useRef, useState } from "react";
import type { AudioAnswer, Capsule, Reaction } from "../api.ts";
import { Chart } from "../charts/Chart.tsx";
import { figure, PIECE_LABEL } from "../format.ts";

/** Renders **bold** from the plan's text as <strong>; everything else stays plain text (no HTML). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

/**
 * The first sentence (or two, if the first is very short) of the plan's text, and the rest. The
 * card leads with that and keeps the rest one tap away: the plan's own words, just not all at once.
 * Bold markers are never split.
 */
export function splitLead(text: string): { lead: string; rest: string } {
  const sentence = /^(.+?[.!?])(?=\s+[A-Z"“(]|\s*$)/s;
  const first = sentence.exec(text);
  if (!first) return { lead: text, rest: "" };
  let lead = first[1]!;
  let rest = text.slice(lead.length).trim();
  if (lead.length < 45 && rest) {
    const second = sentence.exec(rest);
    if (second) {
      lead = `${lead} ${second[1]}`;
      rest = rest.slice(second[1]!.length).trim();
    }
  }
  if ((lead.match(/\*\*/g)?.length ?? 0) % 2) return { lead: text, rest: "" };
  return { lead, rest };
}

const STYLE_TAG: Record<string, string> = { plain: "In plain words", one_number: "The one number that matters", analogy: "Said another way" };

function levelTag(c: Capsule): string | null {
  if (c.level === "expert") return "The full detail";
  if (c.level === "simple") return c.generatedBy === "llm" ? STYLE_TAG[c.style ?? ""] ?? "Said another way" : "Said more simply";
  return null;
}

export function CapsuleCard({ capsule, step, total, onListen }: { capsule: Capsule; step: number; total: number; onListen: () => Promise<AudioAnswer> }) {
  const [showPlanWords, setShowPlanWords] = useState(false);
  const [more, setMore] = useState(false);
  // Standard ideas lead with one sentence; "I'm lost" and "Tell me more" show everything.
  const short = capsule.level === "standard" && capsule.blocks.length > 0;
  const head = short ? splitLead(capsule.blocks[0]!.text) : null;
  const restBlocks = short ? [...(head!.rest ? [head!.rest] : []), ...capsule.blocks.slice(1).map((b) => b.text)] : [];
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

      {short ? (
        <div className="blocks">
          <p className="lead">
            <RichText text={head!.lead} />
          </p>
          {more ? restBlocks.map((t, i) => <p key={i}><RichText text={t} /></p>) : null}
          {restBlocks.length ? (
            <button className="link read-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? "Show less" : "Read more"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="blocks">
          {capsule.blocks.map((b, i) => (
            <p key={i}>
              <RichText text={b.text} />
            </p>
          ))}
        </div>
      )}

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
 * One audio channel for the page, opened inside the tap. Phone browsers (Safari above all) only let
 * a page make sound from a tap, and our audio arrives after a network wait: playing it then through
 * a new <audio> or AudioContext stayed silent on the first tap. Opened here, it stays unlocked.
 */
let sharedCtx: AudioContext | null = null;
function unlockAudio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  sharedCtx ??= new AC();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** `heard` is false when nothing could be played (the clip failed to load or the voice never came). */
type OnEnd = (heard: boolean) => void;

/** A whole clip (mp3 or wav from the cache), played through the unlocked channel. Returns a stop function. */
function playFile(ctx: AudioContext, url: string, onEnd: OnEnd): () => void {
  const controller = new AbortController();
  let src: AudioBufferSourceNode | null = null;
  let finished = false;
  const end = (heard: boolean) => {
    if (finished) return;
    finished = true;
    onEnd(heard);
  };
  void (async () => {
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`audio ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      if (finished) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => end(true);
      src.start();
    } catch {
      end(false);
    }
  })();
  return () => {
    controller.abort();
    try {
      src?.stop();
    } catch {
      /* not started */
    }
    end(true);
  };
}

/**
 * Plays raw 16-bit PCM at 24 kHz as it downloads: each chunk is scheduled right after the last,
 * so the voice starts as soon as the first second arrives. Returns a stop function.
 */
function playPcmStream(ctx: AudioContext, url: string, onEnd: OnEnd): () => void {
  const controller = new AbortController();
  let next = 0;
  let leftover: number | null = null;
  let finished = false;
  const sources: AudioBufferSourceNode[] = [];

  const end = (heard = sources.length > 0) => {
    if (finished) return;
    finished = true;
    onEnd(heard);
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
      // Downloaded: end when the last scheduled chunk has played (at once if nothing came).
      const wait = Math.max(0, next - ctx.currentTime);
      setTimeout(() => end(), wait * 1000 + 100);
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
    end(true);
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
  const stopPlayback = useRef<(() => void) | null>(null);
  // Which tap is current. A stop, a new tap or leaving the card makes older ones stale, so audio that
  // arrives late never starts over the next idea, and two taps never play twice.
  const run = useRef(0);

  const halt = () => {
    stopPlayback.current?.();
    stopPlayback.current = null;
    window.speechSynthesis?.cancel();
  };

  useEffect(
    () => () => {
      run.current++;
      halt();
    },
    [],
  );

  const stop = () => {
    run.current++;
    halt();
    setState("idle");
  };

  const play = async () => {
    // Tapping while it loads or plays stops it.
    if (state === "playing" || state === "loading") return stop();
    const ctx = unlockAudio(); // inside the tap, before any wait
    const me = ++run.current;
    const current = () => me === run.current;
    const done = (heard: boolean) => current() && setState(heard ? "idle" : "no_voice");
    setState("loading");
    try {
      const answer = await onListen();
      if (!current()) return;
      if (answer.kind === "stream" || answer.kind === "audio") {
        if (!ctx) return setState("no_voice");
        stopPlayback.current = answer.kind === "stream" ? playPcmStream(ctx, answer.url, done) : playFile(ctx, answer.url, done);
      } else {
        const voice = await englishVoice();
        if (!current()) return;
        if (!voice) return setState("no_voice");
        const u = new SpeechSynthesisUtterance(answer.text);
        u.voice = voice;
        u.lang = voice.lang;
        u.onend = () => done(true);
        window.speechSynthesis.speak(u);
      }
      setState("playing");
    } catch {
      if (current()) setState("no_voice");
    }
  };

  return (
    <button className="play" onClick={play} aria-pressed={state === "playing"}>
      <span className="play-icon" aria-hidden="true">
        {state === "playing" || state === "loading" ? "■" : "▶"}
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
