// The future self: who greets each person and speaks in the thread. The steps after the
// capsules live in Steps.tsx. Every number shown comes from the plan via plan-coach.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Confetti, GUIDE_NAME, GuideBot, GuideStage, useGuideConversation, useGuideMute, useGuideSays } from "./Guide.tsx";
import type { CaseSummary } from "../api.ts";
import { futureApi, type FutureSelfView } from "../api-future.ts";
import { ListenButton } from "./CapsuleCard.tsx";

const initials = (name: string) =>
  name
    .split(/\s|&/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

/** Portraits of the household's future selves, by first name: the face that speaks in every bubble. */
export const PortraitContext = createContext<Record<string, string>>({});

/** The portrait paths for one household: /avatars/<caseId>-<memberId>.jpg, keyed by lower-case name. */
export function portraitsFor(household: CaseSummary): Record<string, string> {
  return Object.fromEntries(household.members.map((m) => [m.name.toLowerCase(), `/avatars/${household.id}-${m.id}.jpg`]));
}

/** A chat-style message from the guide (or from "me", the reader). The guide says it aloud as it appears. */
export function Bubble({ name: _name, children, tone = "self", big = false }: { name: string; children: React.ReactNode; tone?: "self" | "me"; big?: boolean }) {
  const { muted, toggle, supported } = useGuideMute();
  const text = tone === "self" && typeof children === "string" ? children : undefined;
  const talking = useGuideSays(text, muted);
  return (
    <div className={`bubble-row ${tone} ${big ? "big" : ""}`}>
      {tone === "self" ? (
        <span className="bubble-avatar guide" aria-hidden="true">
          <GuideBot size={big ? 62 : 40} talking={talking} />
        </span>
      ) : null}
      <p className={`bubble ${tone}`}>
        {tone === "self" ? <span className="sr-only">{GUIDE_NAME} says: </span> : null}
        {children}
      </p>
      {text && supported ? (
        <button className="guide-mute" onClick={toggle} aria-label={muted ? `Turn ${GUIDE_NAME}'s voice on` : `Mute ${GUIDE_NAME}`}>
          {muted ? "🔇" : "🔊"}
        </button>
      ) : null}
    </div>
  );
}

// ---- media slot -----------------------------------------------------------------------------

type Media = { kind: "video"; src: string; avatar: string | null; poster: string | null } | { kind: "audio"; src: string; avatar: string | null } | { kind: "none"; avatar: string | null };

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
      // All checks at once: the entry screen waits for the slowest, not the sum.
      const [video, poster, audio, jpg, png] = await Promise.all([
        exists(`/video/${key}.mp4`, "video/"),
        exists(`/video/${key}.jpg`, "image/"),
        exists(`/audio/${key}.mp3`, "audio/"),
        exists(`/avatars/${key}.jpg`, "image/"),
        exists(`/avatars/${key}.png`, "image/"),
      ]);
      const avatar = jpg ? `/avatars/${key}.jpg` : png ? `/avatars/${key}.png` : null;
      const m: Media = video
        ? { kind: "video", src: `/video/${key}.mp4`, avatar, poster: poster ? `/video/${key}.jpg` : avatar }
        : audio
          ? { kind: "audio", src: `/audio/${key}.mp3`, avatar }
          : { kind: "none", avatar };
      if (live) setMedia(m);
    })();
    return () => {
      live = false;
    };
  }, [caseId, memberId]);
  return media;
}

/**
 * The incoming message: the portrait, "sent you a video message", one big play button.
 * Browsers only start sound after a tap, so the tap that opens the message is the one that plays it,
 * full width, without player chrome. When it ends, `onEnded` lets the screen move on.
 */
function MediaSlot({ household, self, onEnded }: { household: CaseSummary; self: FutureSelfView; onEnded: () => void }) {
  const media = useMedia(household.id, self.memberId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<"ready" | "playing" | "ended">("ready");
  if (!media) return <div className="message-card loading" aria-hidden="true" />;
  if (media.kind === "none")
    return (
      <div className="media-slot plain">
        {media.avatar ? (
          <img src={media.avatar} alt={`${self.name} at ${self.age}`} />
        ) : (
          <span className="big-avatar" aria-hidden="true">
            {initials(self.name)}
          </span>
        )}
        <ListenButton onListen={() => futureApi.introAudio(household.id, self.memberId)} />
      </div>
    );

  const play = () => {
    const el = media.kind === "video" ? videoRef.current : audioRef.current;
    if (!el) return;
    el.currentTime = state === "ended" ? 0 : el.currentTime;
    void el.play().then(() => setState("playing"), () => setState("ready"));
  };
  const ended = () => {
    setState("ended");
    onEnded();
  };
  const what = media.kind === "video" ? "a video message" : "a voice message";

  // The still before playing is the video's own first frame, so nothing jumps or zooms when it starts.
  const still = media.kind === "video" ? media.poster : media.avatar;
  return (
    <div className={`message-card ${media.kind} ${state}`}>
      {media.kind === "video" ? (
        <video ref={videoRef} src={media.src} playsInline preload="auto" onEnded={ended} onClick={() => (state === "playing" ? videoRef.current?.pause() : play())} />
      ) : (
        <audio ref={audioRef} src={media.src} preload="auto" onEnded={ended} />
      )}
      {/* The portrait covers the first frame until the message plays, and stays for voice messages. */}
      {still && (media.kind === "audio" || state !== "playing") ? (
        <img className={`message-portrait ${media.kind === "audio" && state === "playing" ? "speaking" : ""}`} src={still} alt={`${self.name} at ${self.age}`} />
      ) : null}
      {state !== "playing" ? (
        <button className="message-play" onClick={play} aria-label={state === "ended" ? `Play ${self.name}'s message again` : `Play ${self.name}'s message`}>
          <span className="message-from">
            <strong>
              {self.name}, {self.age}
            </strong>
            <span>{state === "ended" ? "Play again" : `sent you ${what}`}</span>
          </span>
          <span className="message-button" aria-hidden="true">
            {state === "ended" ? "↻" : "▶"}
          </span>
        </button>
      ) : null}
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

function namesOf(household: CaseSummary, member: string): string {
  const m = household.members.find((x) => x.id === member);
  return m ? m.name : household.members.map((x) => x.name).join(" and ");
}

/** The guide says hello, explains what's coming, and teases the end: meeting yourself. */
export function FutureSelfIntro({ household, member, onStart }: { household: CaseSummary; member: string; onStart: () => void }) {
  const { selves } = useFutureSelves(household.id, member);
  const names = namesOf(household, member);
  const couple = member === "together" || (selves?.length ?? 0) > 1;
  const self = selves?.[0];
  const lines = [
    `Hi ${names}! I'm ${GUIDE_NAME}, your guide.`,
    "Your plan has a lot in it. I'll show it to you one idea at a time, in plain words. If something doesn't click, just tell me and I'll explain it another way.",
    self?.reason === "savings_run_out"
      ? "One thing we'll look at together: the plan shows your savings running low later on. The good news is there's time to change that."
      : "We'll look at what gets you there, step by step, and pick one first move.",
    couple || !self ? "And at the end, you can meet someone special: yourselves, years from now." : `And at the end, you can meet someone special: you, at ${self.age}.`,
  ];
  const { muted, toggle, supported } = useGuideMute();
  const { shown, talking, done } = useGuideConversation(lines, muted);
  return (
    <section className="guide-intro">
      <GuideStage>
        <GuideBot size={150} talking={talking} waving={shown === 1} />
        {supported ? (
          <button className="guide-sound" onClick={toggle} aria-label={muted ? "Turn the guide's voice on" : "Mute the guide"}>
            {muted ? "🔈 Turn sound on" : "🔊 Sound on"}
          </button>
        ) : null}
      </GuideStage>
      <div className="guide-lines" aria-live="polite">
        {lines.slice(0, shown).map((l) => (
          <p key={l} className="bubble self guide-line">
            {l}
          </p>
        ))}
        {!done ? <span className="typing" aria-hidden="true"><i /><i /><i /></span> : null}
      </div>
      <div className="guide-actions">
        <button className={`primary wide ${done ? "ready" : ""}`} onClick={() => (window.speechSynthesis?.cancel(), onStart())}>
          Let's go
        </button>
      </div>
    </section>
  );
}

/**
 * The reward, after the first step is chosen: meet who this step is for. Optional, never first:
 * testers didn't want a face (or a selfie) up front, but were curious once they had committed.
 */
export function MeetFutureSelf({ household, member, onDone }: { household: CaseSummary; member: string; onDone: () => void }) {
  const { selves } = useFutureSelves(household.id, member);
  const [open, setOpen] = useState(false);
  const self = selves?.[0];
  const who = !selves?.length ? "yourself, years from now" : selves.length > 1 ? "yourselves, years from now" : `you, at ${self!.age}`;
  const meetLine = `You did it! You picked a step and a date, and that's the hard part. Want to meet who it's for? It's ${who}.`;
  const { muted } = useGuideMute();
  const meetTalking = useGuideSays(selves ? meetLine : undefined, muted);
  if (selves && !selves.length) {
    onDone();
    return null;
  }
  return (
    <section className="guide-intro meet">
      {!open ? <Confetti /> : null}
      <GuideStage compact>
        <span className={open ? "" : "cheer"}>
          <GuideBot size={104} talking={meetTalking} waving={!open} />
        </span>
      </GuideStage>
      <p className="bubble self guide-line">{meetLine}</p>
      {!open ? (
        <>
          <p className="muted meet-note">
            For a real client this starts from their own selfie, only if they want and with their consent. These families are fictional, so their future selves were designed for the demo.
          </p>
          <div className="guide-actions">
            <button className="primary wide" onClick={() => setOpen(true)}>
              {selves && selves.length > 1 ? "Meet yourselves" : self ? `Meet me at ${self.age}` : "Meet my future self"}
            </button>
            <button className="ghost" onClick={onDone}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          {selves?.map((s) => (
            <Postcard key={s.memberId} household={household} self={s} />
          ))}
          <button className="primary wide" onClick={onDone}>
            Continue
          </button>
        </>
      )}
    </section>
  );
}

/**
 * A postcard from the future self: the illustrated portrait (still, never animated), their message
 * written as a note, and their recorded voice if you want it. Warm, and something you'd keep.
 */
function Postcard({ household, self }: { household: CaseSummary; self: FutureSelfView }) {
  const media = useMedia(household.id, self.memberId);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const voice = media && media.kind !== "none" ? `/audio/${household.id}-${self.memberId}.mp3` : null;
  return (
    <article className="postcard">
      <div className="postcard-top">
        <p className="postcard-from">A postcard from {self.year}</p>
        {media?.avatar ? <img className="postcard-stamp" src={media.avatar} alt={`${self.name} at ${self.age}`} /> : null}
      </div>
      <p className="postcard-text">{self.introText}</p>
      <p className="postcard-sign">
        — {self.name}, {self.age}
      </p>
      {voice ? (
        <>
          <audio ref={audioRef} src={voice} preload="none" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
          <button
            className="ghost postcard-play"
            onClick={() => {
              const a = audioRef.current;
              if (!a) return;
              if (playing) a.pause();
              else void a.play().then(() => setPlaying(true), () => setPlaying(false));
            }}
          >
            {playing ? "Pause" : `Hear it in ${self.name}'s voice`}
          </button>
        </>
      ) : null}
    </article>
  );
}
