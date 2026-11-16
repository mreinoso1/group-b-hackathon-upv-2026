// The future self: who greets each person and speaks in the thread. The steps after the
// capsules live in Steps.tsx. Every number shown comes from the plan via plan-coach.
import { createContext, useContext, useEffect, useRef, useState } from "react";
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

/** A chat-style message from the future self, with their portrait when we have one. */
export function Bubble({ name, children, tone = "self" }: { name: string; children: React.ReactNode; tone?: "self" | "me" }) {
  const portrait = useContext(PortraitContext)[name.toLowerCase()];
  const [broken, setBroken] = useState(false);
  return (
    <div className={`bubble-row ${tone}`}>
      {tone === "self" ? (
        portrait && !broken ? (
          <img className="bubble-avatar photo" src={portrait} alt="" aria-hidden="true" onError={() => setBroken(true)} />
        ) : (
          <span className="bubble-avatar" aria-hidden="true">
            {initials(name)}
          </span>
        )
      ) : null}
      <p className={`bubble ${tone}`}>
        {tone === "self" ? <span className="sr-only">{name}'s future self says: </span> : null}
        {children}
      </p>
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
  return <IntroMessages household={household} selves={selves} onStart={onStart} />;
}

function IntroMessages({ household, selves, onStart }: { household: CaseSummary; selves: FutureSelfView[]; onStart: () => void }) {
  const [heard, setHeard] = useState(0);
  const allHeard = heard >= selves.length;
  return (
    <section className="future-intro">
      {selves.map((s) => (
        <article key={s.memberId} className="future-card">
          <p className="kicker">A message from {s.year}</p>
          <MediaSlot household={household} self={s} onEnded={() => setHeard((n) => n + 1)} />
          <Bubble name={s.name}>{s.introText}</Bubble>
        </article>
      ))}
      <button className={`primary wide ${allHeard ? "ready" : ""}`} onClick={onStart}>
        Show me
      </button>
    </section>
  );
}
