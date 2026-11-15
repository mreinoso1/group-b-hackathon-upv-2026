// The future self: who greets each person and speaks in the thread. The steps after the
// capsules live in Steps.tsx. Every number shown comes from the plan via plan-coach.
import { useEffect, useState } from "react";
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

type Media = { kind: "video"; src: string; avatar: string | null } | { kind: "audio"; src: string; avatar: string | null } | { kind: "none"; avatar: string | null };

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
      const [video, audio, jpg, png] = await Promise.all([
        exists(`/video/${key}.mp4`, "video/"),
        exists(`/audio/${key}.mp3`, "audio/"),
        exists(`/avatars/${key}.jpg`, "image/"),
        exists(`/avatars/${key}.png`, "image/"),
      ]);
      const avatar = jpg ? `/avatars/${key}.jpg` : png ? `/avatars/${key}.png` : null;
      const m: Media = video
        ? { kind: "video", src: `/video/${key}.mp4`, avatar }
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

function MediaSlot({ household, self }: { household: CaseSummary; self: FutureSelfView }) {
  const media = useMedia(household.id, self.memberId);
  if (!media) return <div className="media-slot loading" aria-hidden="true" />;
  if (media.kind === "video")
    return (
      <video className="media-slot" src={media.src} poster={media.avatar ?? undefined} controls playsInline preload="metadata">
        <track kind="captions" />
      </video>
    );
  if (media.kind === "audio")
    return (
      <div className="media-slot audio">
        {media.avatar ? <img src={media.avatar} alt={`${self.name} at ${self.age}`} /> : <span className="big-avatar">{initials(self.name)}</span>}
        <audio src={media.src} controls preload="metadata" />
      </div>
    );
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
