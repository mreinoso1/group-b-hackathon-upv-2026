// Summit, the guide: a small, friendly robot (a nod to a sherpa, a mountain guide) who walks each
// person through their plan. Testers found an AI face unsettling at first, so the guide speaks,
// and the future self waits until the end, as something you choose to meet.
import { useEffect, useState } from "react";

export const GUIDE_NAME = "Summit";

/** The robot. `talking` animates the mouth; it always blinks now and then. */
export function GuideBot({ size = 120, talking = false, waving = false }: { size?: number; talking?: boolean; waving?: boolean }) {
  return (
    <svg className={`guide-bot ${talking ? "talking" : ""} ${waving ? "waving" : ""}`} width={size} height={size} viewBox="0 0 180 220" role="img" aria-label={`${GUIDE_NAME}, your guide`}>
      <line x1="90" y1="38" x2="90" y2="8" stroke="#1E2A4A" strokeWidth="4" strokeLinecap="round" />
      <path className="guide-flag" d="M90 8 L118 16 L90 24 Z" fill="#E8A33D" />
      <rect x="132" y="140" width="34" height="58" rx="10" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
      <rect x="46" y="134" width="88" height="80" rx="26" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
      <circle cx="90" cy="172" r="12" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
      <rect x="22" y="148" width="22" height="46" rx="11" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
      <rect className="guide-arm" x="136" y="150" width="22" height="40" rx="11" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
      <g className="guide-head">
        <rect x="34" y="38" width="112" height="92" rx="34" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
        <rect x="52" y="60" width="76" height="46" rx="20" fill="#1E2A4A" />
        <g className="guide-eyes">
          <ellipse cx="74" cy="80" rx="7" ry="9" fill="#9FE1CB" />
          <ellipse cx="106" cy="80" rx="7" ry="9" fill="#9FE1CB" />
        </g>
        <path className="guide-smile" d="M78 95 Q90 103 102 95" fill="none" stroke="#9FE1CB" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse className="guide-mouth" cx="90" cy="97" rx="9" ry="5" fill="#9FE1CB" />
        <circle cx="40" cy="96" r="6" fill="#E8A33D" />
        <circle cx="140" cy="96" r="6" fill="#E8A33D" />
      </g>
    </svg>
  );
}

// ---- the guide's voice: the device's own English voice (no network, no budget) ----

const MUTE_KEY = "future-you-guide-muted";

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The best English voice the device has: the natural/online ones first, then any en-US, then any English. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|online|neural/i.test(v.name) ? 4 : 0) +
    (/google us english|samantha|aria|jenny|ava|allison/i.test(v.name) ? 3 : 0) +
    (v.lang === "en-US" ? 2 : 0) +
    (v.localService ? 0 : 1);
  return voices.sort((a, b) => score(b) - score(a))[0];
}

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Speaks one line; resolves when it ends (or right away when the device can't speak). */
function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak()) return resolve();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.03;
    u.pitch = 1.1;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // Some browsers never fire onend: a generous timeout keeps the conversation moving.
    window.setTimeout(finish, 1500 + text.length * 90);
    synth.speak(u);
  });
}

/** Mute switch shared by every screen (remembered on this device). */
export function useGuideMute() {
  const [muted, setMuted] = useState(readMuted);
  const toggle = () =>
    setMuted((m) => {
      try {
        window.localStorage.setItem(MUTE_KEY, m ? "0" : "1");
      } catch {
        /* storage may be unavailable; the switch still works for this page */
      }
      if (!m && canSpeak()) window.speechSynthesis.cancel();
      return !m;
    });
  return { muted, toggle, supported: canSpeak() };
}

/**
 * A conversation: lines appear one by one, each spoken aloud while the robot's mouth moves; the
 * next comes when it has finished. Muted (or no voice on the device), each line waits roughly the
 * time it takes to read it.
 */
export function useGuideConversation(lines: string[], muted: boolean) {
  const [shown, setShown] = useState(0);
  const [talking, setTalking] = useState(false);
  const key = lines.join("|");
  useEffect(() => {
    let live = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce && muted) {
      setShown(lines.length);
      return;
    }
    (async () => {
      for (let i = 0; i < lines.length && live; i++) {
        setShown(i + 1);
        if (!muted && canSpeak()) {
          setTalking(true);
          await say(lines[i]!);
          if (!live) return;
          setTalking(false);
          await new Promise((r) => window.setTimeout(r, 250));
        } else {
          setTalking(true);
          await new Promise((r) => window.setTimeout(r, Math.min(2600, 700 + lines[i]!.length * 22)));
          setTalking(false);
        }
      }
    })();
    return () => {
      live = false;
      if (canSpeak()) window.speechSynthesis.cancel();
      setTalking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, muted]);
  return { shown, talking, done: shown >= lines.length && !talking };
}

/** One short line, spoken once when it appears (the guide in every capsule). */
export function useGuideSays(text: string | undefined, muted: boolean) {
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!text) return;
    let live = true;
    setTalking(true);
    const stopAfter = (ms: number) => window.setTimeout(() => live && setTalking(false), ms);
    if (!muted && canSpeak()) {
      window.speechSynthesis.cancel();
      void say(text).then(() => live && setTalking(false));
    } else stopAfter(Math.min(2200, 600 + text.length * 20));
    return () => {
      live = false;
      if (canSpeak()) window.speechSynthesis.cancel();
    };
  }, [text, muted]);
  return talking;
}
