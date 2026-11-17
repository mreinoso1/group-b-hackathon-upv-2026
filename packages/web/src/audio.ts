// Playing our audio in the browser, shared by Listen and the guide. Everything goes through one
// AudioContext, unlocked by a tap, because phone browsers only allow sound that starts from one.

/**
 * One audio channel for the page, opened inside the tap. Phone browsers (Safari above all) only let
 * a page make sound from a tap, and our audio arrives after a network wait: playing it then through
 * a new <audio> or AudioContext stayed silent on the first tap. Opened here, it stays unlocked.
 */
let sharedCtx: AudioContext | null = null;
export function unlockAudio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  sharedCtx ??= new AC();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/** `heard` is false when nothing could be played (the clip failed to load or the voice never came). */
export type OnEnd = (heard: boolean) => void;

/** A whole clip (mp3 or wav from the cache), played through the unlocked channel. Returns a stop function. */
export function playFile(ctx: AudioContext, url: string, onEnd: OnEnd): () => void {
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
export function playPcmStream(ctx: AudioContext, url: string, onEnd: OnEnd): () => void {
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

/** Whether this browser can play our audio at all. */
export function audioSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

// The first tap anywhere on the page unlocks the channel, so later sound (the guide's next line,
// a Listen) can play even when it starts after a wait.
if (typeof document !== "undefined") document.addEventListener("pointerdown", () => unlockAudio(), { once: true, capture: true });
