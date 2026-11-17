// Summit, the guide: a small, friendly robot (a nod to a sherpa, a mountain guide) who walks each
// person through their plan. Testers found an AI face unsettling at first, so the guide speaks,
// and the future self waits until the end, as something you choose to meet.
import { useEffect, useState } from "react";

export const GUIDE_NAME = "Summit";

/**
 * The robot, alive: it floats, blinks, looks around, its antenna light pulses; when it talks, its
 * mouth becomes a little equaliser and its arms move; it waves hello. Driven by JavaScript (not
 * CSS), so it moves on every device; only the floating and waving calm down with reduced motion.
 */
export function GuideBot({ size = 120, talking = false, waving = false }: { size?: number; talking?: boolean; waving?: boolean }) {
  const t = useClock();
  const reduce = useReducedMotion();
  const blink = Math.sin(t / 1900) > 0.985 || Math.sin(t / 2700 + 1) > 0.993;
  const look = Math.round(Math.sin(t / 2300) * 3 * 10) / 10;
  const bob = reduce ? 0 : Math.sin(t / 520) * 3;
  const glow = 0.55 + 0.45 * Math.sin(t / 300);
  const bars = [0, 1, 2, 3, 4].map((i) => (talking ? 4 + Math.abs(Math.sin(t / 95 + i * 1.3)) * 11 : 0));
  const armL = talking ? -8 + Math.sin(t / 260) * 10 : -4;
  const armR = waving && !reduce ? -140 + Math.sin(t / 110) * 22 : talking ? 8 + Math.sin(t / 240 + 2) * 10 : 4;
  return (
    <svg className="guide-bot" width={size} height={size * 1.2} viewBox="0 0 200 240" role="img" aria-label={`${GUIDE_NAME}, your guide`}>
      <ellipse cx="100" cy="230" rx={46 - bob} ry="7" fill="#1E2A4A" opacity="0.12" />
      <g transform={`translate(0 ${bob})`}>
        {/* backpack */}
        <rect x="128" y="138" width="34" height="56" rx="11" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3.5" />
        <rect x="134" y="148" width="22" height="10" rx="4" fill="#F3C16E" />
        {/* arms (behind the body) */}
        <g transform={`rotate(${armL} 58 146)`}>
          <rect x="34" y="140" width="26" height="50" rx="13" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="3.5" />
          <circle cx="47" cy="190" r="9" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
        </g>
        <g transform={`rotate(${armR} 142 146)`}>
          <rect x="140" y="140" width="26" height="50" rx="13" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="3.5" />
          <circle cx="153" cy="190" r="9" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
        </g>
        {/* body */}
        <rect x="58" y="132" width="84" height="76" rx="26" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
        <path d="M70 136 L86 170 M130 136 L114 170" stroke="#E8A33D" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="176" r="11" fill="#E8A33D" opacity={0.6 + glow * 0.4} stroke="#1E2A4A" strokeWidth="3" />
        <circle cx="100" cy="176" r="4" fill="#fff" opacity={glow} />
        {/* feet */}
        <rect x="70" y="204" width="24" height="14" rx="7" fill="#1E2A4A" />
        <rect x="106" y="204" width="24" height="14" rx="7" fill="#1E2A4A" />
        {/* antenna */}
        <line x1="100" y1="40" x2="100" y2="16" stroke="#1E2A4A" strokeWidth="4" strokeLinecap="round" />
        <path d={`M100 12 L${124 + Math.sin(t / 300) * 3} ${18 + Math.sin(t / 300) * 2} L100 26 Z`} fill="#E8A33D" stroke="#1E2A4A" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="100" cy="12" r="6" fill="#9FE1CB" stroke="#1E2A4A" strokeWidth="2.5" opacity={0.7 + glow * 0.3} />
        {/* head */}
        <rect x="36" y="38" width="128" height="98" rx="38" fill="#F8F1E5" stroke="#1E2A4A" strokeWidth="4" />
        <rect x="28" y="74" width="12" height="28" rx="6" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
        <rect x="160" y="74" width="12" height="28" rx="6" fill="#E8A33D" stroke="#1E2A4A" strokeWidth="3" />
        <rect x="54" y="56" width="92" height="62" rx="24" fill="#1E2A4A" />
        {/* eyes: screen eyes with pupils that look around, and a blink */}
        {[78, 122].map((cx) => (
          <g key={cx}>
            <rect x={cx - 10} y={blink ? 78 : 68} width="20" height={blink ? 3 : 22} rx={blink ? 1.5 : 9} fill="#9FE1CB" />
            {!blink ? <circle cx={cx + look} cy="80" r="4.5" fill="#1E2A4A" /> : null}
            {!blink ? <circle cx={cx + look + 2} cy="76" r="1.6" fill="#fff" /> : null}
          </g>
        ))}
        <circle cx="64" cy="100" r="5" fill="#F0997B" opacity="0.55" />
        <circle cx="136" cy="100" r="5" fill="#F0997B" opacity="0.55" />
        {/* mouth: a smile at rest, an equaliser while talking */}
        {talking ? (
          bars.map((h, i) => <rect key={i} x={84 + i * 7} y={106 - h / 2} width="4" height={h} rx="2" fill="#9FE1CB" />)
        ) : (
          <path d="M86 102 Q100 112 114 102" fill="none" stroke="#9FE1CB" strokeWidth="3.5" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
}

/** A mountain stage for the guide: a nod to a sherpa, the mountain guide. */
export function GuideStage({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`guide-stage ${compact ? "small" : ""}`}>
      <svg className="guide-mountains" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <circle cx="318" cy="62" r="26" fill="#F3C16E" opacity="0.55" />
        <g className="guide-clouds">
          <ellipse cx="70" cy="48" rx="26" ry="9" fill="#fff" opacity="0.9" />
          <ellipse cx="88" cy="42" rx="16" ry="9" fill="#fff" opacity="0.9" />
          <ellipse cx="250" cy="34" rx="20" ry="7" fill="#fff" opacity="0.8" />
        </g>
        <path d="M-10 200 L80 92 L130 140 L200 70 L270 150 L320 104 L410 200 Z" fill="#E4DDD0" />
        <path d="M200 70 L218 92 L206 88 L198 98 L188 86 L182 92 Z" fill="#fff" />
        <path d="M80 92 L94 108 L84 106 L76 112 L68 104 Z" fill="#fff" />
        <path d="M-10 200 L60 150 L130 186 L210 132 L300 178 L360 150 L410 200 Z" fill="#EFE3CF" />
      </svg>
      <div className="guide-stage-inner">{children}</div>
    </div>
  );
}

/** A single clock for the robot's movements (about 30 frames a second, paused when the tab is hidden). */
function useClock(): number {
  const [t, setT] = useState(() => performance.now());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now;
        setT(now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

function useReducedMotion(): boolean {
  const [reduce] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  return reduce;
}

// ---- the guide's voice: the device's own English voice (no network, no budget) ----

// Remembered only for this tab (sessionStorage): every new visit starts quiet, whatever was chosen before.
const VOICE_KEY = "future-you-voice";

/** Quiet by default: the guide only speaks once someone turns its voice on. */
function readMuted(): boolean {
  try {
    return window.sessionStorage.getItem(VOICE_KEY) !== "on";
  } catch {
    return true;
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

/** Mute switch shared by every screen (remembered while this tab is open). */
export function useGuideMute() {
  const [muted, setMuted] = useState(readMuted);
  const toggle = () =>
    setMuted((m) => {
      try {
        window.sessionStorage.setItem(VOICE_KEY, m ? "on" : "off");
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

// ---- the climb: each idea is a step up the mountain ----

/** The trail's turns, in a 360 × 84 box, from the foot (left) to the summit (right). */
const TRAIL: [number, number][] = [
  [14, 74],
  [92, 62],
  [58, 50],
  [168, 42],
  [132, 30],
  [250, 24],
  [226, 16],
  [338, 10],
];

function trailPoint(f: number): [number, number] {
  const segs = TRAIL.slice(1).map((p, i) => {
    const a = TRAIL[i]!;
    return { a, b: p, len: Math.hypot(p[0] - a[0], p[1] - a[1]) };
  });
  const total = segs.reduce((n, s) => n + s.len, 0);
  let d = Math.max(0, Math.min(1, f)) * total;
  for (const s of segs) {
    if (d <= s.len) {
      const k = s.len ? d / s.len : 0;
      return [s.a[0] + (s.b[0] - s.a[0]) * k, s.a[1] + (s.b[1] - s.a[1]) * k];
    }
    d -= s.len;
  }
  return TRAIL[TRAIL.length - 1]!;
}

/** Summit climbing the plan: one step up per idea; at the last idea, the flag goes up on the peak. */
export function Climb({ step, total }: { step: number; total: number }) {
  const f = total > 1 ? (step - 1) / (total - 1) : 0;
  const [x, y] = trailPoint(f);
  const top = step >= total && total > 0;
  const dots = Array.from({ length: Math.max(total, 0) }, (_, i) => trailPoint(total > 1 ? i / (total - 1) : 0));
  return (
    <div className={`climb ${top ? "top" : ""}`} aria-label={`Idea ${step} of ${total}`}>
      <svg viewBox="0 0 360 84" aria-hidden="true">
        <path d="M0 84 L60 46 L104 62 L196 18 L240 34 L300 4 L360 30 L360 84 Z" fill="#efe3cf" />
        <path d="M196 18 L208 26 L200 25 L194 30 L186 25 Z M300 4 L312 13 L304 12 L298 17 L290 12 Z" fill="#fff" />
        <polyline points={TRAIL.map((p) => p.join(",")).join(" ")} fill="none" stroke="#c9b28c" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
        {dots.map(([dx, dy], i) => (
          <circle key={i} cx={dx} cy={dy} r={i < step ? 3.4 : 2.6} fill={i < step ? "#E8A33D" : "#fff"} stroke="#c9b28c" strokeWidth="1.2" />
        ))}
        <g className="climb-flag" transform="translate(338 10)">
          <line x1="0" y1="0" x2="0" y2="-14" stroke="#1E2A4A" strokeWidth="2" />
          <path d="M0 -14 L12 -10 L0 -6 Z" fill={top ? "#E8A33D" : "#d8cbb4"} />
        </g>
      </svg>
      <span className="climb-bot" style={{ left: `${(x / 360) * 100}%`, top: `${(y / 84) * 100}%` }}>
        <GuideBot size={30} waving={top} />
      </span>
    </div>
  );
}

/** Confetti for the moment someone commits to their first step. */
export function Confetti() {
  const colors = ["#E8A33D", "#9FE1CB", "#F0997B", "#7F77DD", "#1E2A4A", "#F3C16E"];
  const bits = Array.from({ length: 46 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i % 9) * 0.07,
    dur: 1.6 + ((i * 13) % 10) / 10,
    rot: (i * 47) % 360,
    color: colors[i % colors.length]!,
    w: 6 + (i % 3) * 2,
  }));
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          style={{ left: `${b.left}%`, background: b.color, width: b.w, height: b.w * 1.6, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, transform: `rotate(${b.rot}deg)` }}
        />
      ))}
    </div>
  );
}
