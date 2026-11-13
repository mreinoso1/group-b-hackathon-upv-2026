// Charts in the Sherpas visual language, built from the capsule's ChartSpec.
// Mark specs (dataviz skill): bars ≤ 16px with a square baseline and 4px rounded data end,
// 2px lines, ≥8px markers with a 2px surface ring, area wash ~10%, hairline solid grid,
// text in text tokens (never the data colour), one focus colour (blue) over a slate context.
// Every number shown is a figure from the spec (exact, see moneyShort) or an axis tick.
import { useState } from "react";
import type { ChartSpec, Milestone } from "@bite/plan-core";
import { money, moneyShort } from "../format.ts";

const W = 340;
const PAD = 6;
/** Average glyph width of the 12px chart font, used to keep labels inside the chart. */
const CHAR_W = 6.6;
const BAR = 14;

/** Puts a label next to x on the side where it fits; clamps it inside the chart otherwise. */
export function placeLabel(x: number, text: string, gap = 8): { x: number; anchor: "start" | "end" } {
  const w = text.length * CHAR_W;
  if (x + gap + w <= W) return { x: x + gap, anchor: "start" };
  if (x - gap - w >= 0) return { x: x - gap, anchor: "end" };
  return { x: Math.max(0, W - w), anchor: "start" };
}

/** Horizontal bar: square at the baseline (x=0), 4px rounded data end. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

export function Chart({ spec, simple = false }: { spec: ChartSpec; simple?: boolean }) {
  switch (spec.kind) {
    case "score":
      return <ScoreChart spec={spec} simple={simple} />;
    case "bars":
      return <BarsChart spec={spec} simple={simple} />;
    case "range":
      return <RangeChart spec={spec} />;
    case "have-need":
      return <HaveNeedChart spec={spec} />;
    case "timeline":
      return <TimelineChart spec={spec} simple={simple} />;
  }
}

function Panel({ title, desc, children }: { title?: string; desc: string; children: React.ReactNode }) {
  return (
    <figure className="chart">
      {title ? <figcaption>{title}</figcaption> : null}
      <div className="chart-panel" role="img" aria-label={desc}>
        {children}
      </div>
    </figure>
  );
}

// ---- score: the Sherpas hero card -------------------------------------------------------

const BAND_COLOUR: Record<string, string> = { red: "critical", orange: "serious", yellow: "warning", green: "good" };

function ScoreChart({ spec, simple }: { spec: Extract<ChartSpec, { kind: "score" }>; simple: boolean }) {
  const status = BAND_COLOUR[spec.colour ?? ""] ?? "warning";
  return (
    <figure className="score-card" aria-label={`Financial health score ${spec.score} out of 100, ${spec.band}`}>
      <p className="score-kicker">Your Financial Health Score is</p>
      <p className="score-row">
        <span className={`score-number status-${status}`}>{spec.score}</span>
        <span className="score-meta">
          <span className={`status-pill status-${status}`}>{spec.band}</span>
          <span className="muted">out of 100</span>
        </span>
      </p>
      {simple ? null : (
        <ul className="meters">
          {spec.pillars.map((p) => (
            <li key={p.label}>
              <span className="meter-label">{p.label}</span>
              <span className="meter" aria-hidden="true">
                <span className={`meter-fill ${p.score < 50 ? "status-serious-bg" : ""}`} style={{ width: `${Math.max(3, p.score)}%` }} />
              </span>
              <span className="meter-value">{p.score}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

// ---- bars ------------------------------------------------------------------------------------

function BarsChart({ spec, simple }: { spec: Extract<ChartSpec, { kind: "bars" }>; simple: boolean }) {
  const bars = simple ? spec.bars.filter((b, i) => b.highlight || i === 0).slice(0, 2) : spec.bars;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const row = 42;
  const valueRoom = Math.max(...bars.map((b) => moneyShort(b.value).length)) * CHAR_W + 10;
  return (
    <Panel title={spec.title} desc={bars.map((b) => `${b.label}: ${money(b.value)}${b.note ? ` (${b.note})` : ""}`).join("; ")}>
      <svg viewBox={`0 0 ${W} ${bars.length * row + PAD}`} width="100%">
        {bars.map((b, i) => {
          const top = PAD + i * row;
          const w = Math.max(4, ((W - valueRoom) * b.value) / max);
          return (
            <g key={`${b.label}-${i}`} className="hit">
              <title>{`${b.label}: ${money(b.value)}${b.note ? ` · ${b.note}` : ""}`}</title>
              <text x={0} y={top + 10} className="label">
                {truncate(b.label, 38)}
                {b.note ? <tspan className={b.highlight ? "strong" : "muted"}>{`  ${b.note}`}</tspan> : null}
              </text>
              <path d={barPath(0, top + 18, w, BAR)} className={b.highlight ? "mark-focus" : "mark"} />
              <text x={w + 6} y={top + 29} className="value">
                {moneyShort(b.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}

// ---- range (cash cushion) ----------------------------------------------------------------------

function RangeChart({ spec }: { spec: Extract<ChartSpec, { kind: "range" }> }) {
  const top = Math.max(spec.value, spec.max) * 1.12;
  const sx = (v: number) => 8 + ((W - 16) * v) / top;
  const valueText = `${spec.valueLabel} · ${moneyShort(spec.value)}`;
  const v = placeLabel(sx(spec.value), valueText, 10);
  const pill = `${moneyShort(spec.min)} – ${moneyShort(spec.max)}`;
  const pillW = pill.length * 6.4 + 18;
  const pillX = Math.min(Math.max(0, (sx(spec.min) + sx(spec.max)) / 2 - pillW / 2), W - pillW);
  return (
    <Panel title={spec.title} desc={`${spec.valueLabel}: ${money(spec.value)}. ${spec.rangeLabel}: ${money(spec.min)} to ${money(spec.max)}`}>
      <svg viewBox={`0 0 ${W} 120`} width="100%">
        <line x1={8} x2={W - 8} y1={56} y2={56} className="axis" />
        <rect x={sx(spec.min)} y={44} width={Math.max(3, sx(spec.max) - sx(spec.min))} height={24} rx={4} className="band" />
        <g>
          <title>{`${spec.rangeLabel}: ${money(spec.min)} to ${money(spec.max)}`}</title>
          <rect x={pillX} y={78} width={pillW} height={22} rx={11} className="pill" />
          <text x={pillX + pillW / 2} y={93} textAnchor="middle" className="pill-text">
            {pill}
          </text>
          <text x={pillX + pillW / 2} y={116} textAnchor="middle" className="muted">
            {spec.rangeLabel}
          </text>
        </g>
        <g className="hit">
          <title>{`${spec.valueLabel}: ${money(spec.value)}`}</title>
          <circle cx={sx(spec.value)} cy={56} r={7} className="dot-focus" />
        </g>
        <text x={v.x} y={30} textAnchor={v.anchor} className="label strong">
          {valueText}
        </text>
      </svg>
    </Panel>
  );
}

// ---- have vs recommended ---------------------------------------------------------------------

function HaveNeedChart({ spec }: { spec: Extract<ChartSpec, { kind: "have-need" }> }) {
  const max = Math.max(...spec.rows.flatMap((r) => [r.have, r.need]), 1) * 1.04;
  const row = 70;
  const sw = (v: number) => (v > 0 ? Math.max(6, ((W - 8) * v) / max) : 0);
  return (
    <Panel title={spec.title} desc={spec.rows.map((r) => `${r.label}: has ${money(r.have)}, ${r.needLabel} ${money(r.need)}`).join("; ")}>
      <svg viewBox={`0 0 ${W} ${spec.rows.length * row + PAD}`} width="100%">
        {spec.rows.map((r, i) => {
          const top = PAD + i * row;
          const short = r.have < r.need;
          return (
            <g key={r.label} className="hit">
              <title>{`${r.label}: has ${money(r.have)}; ${r.needLabel} ${money(r.need)}`}</title>
              <text x={0} y={top + 10} className="label strong">
                {r.label}
              </text>
              <rect x={0} y={top + 20} width={W - 8} height={BAR} rx={4} className="track" />
              <path d={barPath(0, top + 20, sw(r.have), BAR)} className={short ? "mark" : "mark-focus"} />
              <line x1={sw(r.need)} x2={sw(r.need)} y1={top + 15} y2={top + 39} className="need-mark" />
              <text x={0} y={top + 54} className="muted">
                Has <tspan className="value">{moneyShort(r.have)}</tspan>
                {` · ${r.needLabel} `}
                <tspan className="value">{moneyShort(r.need)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}

// ---- living map: net worth with life events ----------------------------------------------------

type IconKind = "vacation" | "car" | "home" | "college" | "retirement" | "notice" | "goal";

function iconKind(m: { type: string; subType?: string; distress: boolean }): IconKind {
  if (m.distress) return "notice";
  if (m.type === "VACATION") return "vacation";
  if (m.type === "COLLEGE") return "college";
  if (m.type === "RETIREMENT") return "retirement";
  if (m.subType === "VEHICLE_PURCHASE") return "car";
  if (m.subType === "REAL_ESTATE_PURCHASE") return "home";
  return "goal";
}

/** Tiny 12×12 glyphs, drawn around (0,0), stroke only. */
function Glyph({ kind }: { kind: IconKind }) {
  switch (kind) {
    case "vacation":
      return <path d="M-4 3 L4 3 M0 3 V-3 M0 -3 C-3 -5 -5 -3 -5 -2 M0 -3 C3 -5 5 -3 5 -2" />;
    case "car":
      return <path d="M-5 2 V0 L-3 -3 H3 L5 0 V2 Z M-3 3.5 v0 M3 3.5 v0" />;
    case "home":
      return <path d="M-5 0 L0 -4.5 L5 0 M-3.5 -1 V4 H3.5 V-1" />;
    case "college":
      return <path d="M-5.5 -1 L0 -4 L5.5 -1 L0 2 Z M-3 0.5 V3 C-1 4.5 1 4.5 3 3 V0.5" />;
    case "retirement":
      return <path d="M-5 3 H5 M-3.5 3 A3.5 3.5 0 0 1 3.5 3 M0 -4 V-2.5 M-4 -2 L-3 -1 M4 -2 L3 -1" />;
    case "notice":
      return <path d="M0 -3.5 V0.5 M0 3 v0.2" />;
    case "goal":
      return <path d="M-3 0 H3 M0 -3 V3" />;
  }
}

/** Milestones in the same year share one row: "2048 · Melanie's Retirement, Timothy's Retirement". */
export function groupMilestones(ms: Milestone[]): { year: number; label: string; distress: boolean; icon: IconKind }[] {
  const groups: { year: number; label: string; distress: boolean; icon: IconKind }[] = [];
  for (const m of ms) {
    const last = groups[groups.length - 1];
    if (last && last.year === m.year && last.distress === m.distress) last.label += `, ${m.label}`;
    else groups.push({ year: m.year, label: m.label, distress: m.distress, icon: iconKind(m) });
  }
  return groups;
}

/** Clean axis ticks (not plan figures): 0, 1M, 2M… */
function ticks(maxV: number, minV: number): number[] {
  const span = maxV - Math.min(0, minV);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 4.5) ?? raw;
  const out: number[] = [];
  for (let t = Math.floor(Math.min(0, minV) / step) * step; t <= maxV + 1e-6; t += step) out.push(t);
  return out;
}

function axisMoney(n: number): string {
  if (n === 0) return "$0";
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${+(a / 1_000_000).toFixed(1)}M` : `${Math.round(a / 1000)}K`;
  return `${n < 0 ? "-" : ""}$${s}`;
}

function TimelineChart({ spec, simple }: { spec: Extract<ChartSpec, { kind: "timeline" }>; simple: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = spec.points;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const maxV = Math.max(...pts.map((p) => p.value), 1);
  const minV = Math.min(0, ...pts.map((p) => p.value));
  const tickValues = ticks(maxV, minV);
  const topV = Math.max(maxV, tickValues[tickValues.length - 1]!);
  const botV = Math.min(minV, tickValues[0]!);
  const H = 170;
  const left = 38;
  const right = W - 6;
  const plotTop = 10;
  const plotBottom = H - 26;
  const sx = (year: number) => left + ((right - left) * (year - first.year)) / Math.max(1, last.year - first.year);
  const sy = (v: number) => plotTop + (plotBottom - plotTop) * (1 - (v - botV) / (topV - botV || 1));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.year).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(last.year)},${sy(Math.max(0, botV))} L${sx(first.year)},${sy(Math.max(0, botV))} Z`;
  const inRange = spec.milestones.filter((m) => m.year >= first.year && m.year <= last.year);
  const groups = groupMilestones(simple ? inRange.filter((m) => m.type === "RETIREMENT").slice(0, 1) : inRange);
  const retireYear = spec.milestones.find((m) => m.type === "RETIREMENT")?.year;
  const atRetire = retireYear ? pts.find((p) => p.year === retireYear) : undefined;
  const showAge = pts.every((p) => p.age !== undefined);
  const xTicks = pts.filter((_, i) => i % Math.ceil(pts.length / 6) === 0);
  const hp = hover !== null ? pts[hover] : undefined;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const year = first.year + Math.round(((x - left) / (right - left)) * (last.year - first.year));
    const i = pts.findIndex((p) => p.year === Math.min(last.year, Math.max(first.year, year)));
    setHover(i >= 0 ? i : null);
  };

  return (
    <figure className="chart">
      <figcaption>{spec.title}</figcaption>
      <dl className="stats">
        <div>
          <dt>Today</dt>
          <dd>{moneyShort(first.value)}</dd>
        </div>
        {atRetire ? (
          <div>
            <dt>At retirement</dt>
            <dd>{moneyShort(atRetire.value)}</dd>
          </div>
        ) : null}
        <div>
          <dt>End of plan</dt>
          <dd>{moneyShort(last.value)}</dd>
        </div>
      </dl>
      <div className="chart-panel plain" role="img" aria-label={`${spec.seriesLabel} from ${first.year} to ${last.year}. Milestones: ${groups.map((m) => `${m.year} ${m.label}`).join("; ")}`}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="timeline">
          <defs>
            <linearGradient id="nw-wash" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="wash-top" />
              <stop offset="100%" className="wash-bottom" />
            </linearGradient>
          </defs>
          {tickValues.map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={sy(t)} y2={sy(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={left - 6} y={sy(t) + 4} textAnchor="end" className="tick">
                {axisMoney(t)}
              </text>
            </g>
          ))}
          {xTicks.map((p) => (
            <text key={p.year} x={sx(p.year)} y={H - 6} textAnchor="middle" className="tick">
              {showAge ? p.age : p.year}
            </text>
          ))}
          <path d={area} fill="url(#nw-wash)" />
          <path d={line} className="line" />
          {retireYear ? <line x1={sx(retireYear)} x2={sx(retireYear)} y1={plotTop} y2={plotBottom} className="retire-line" /> : null}
          {groups.map((m) => (
            <g key={`icon-${m.year}-${m.label}`} transform={`translate(${sx(m.year)} ${plotBottom - 11})`} className={`event ${m.icon === "retirement" ? "event-focus" : ""}`}>
              <title>{`${m.year} · ${m.label}`}</title>
              <circle r={9} />
              <Glyph kind={m.icon} />
            </g>
          ))}
          {hp ? (
            <g className="crosshair" pointerEvents="none">
              <line x1={sx(hp.year)} x2={sx(hp.year)} y1={plotTop} y2={plotBottom} />
              <circle cx={sx(hp.year)} cy={sy(hp.value)} r={4.5} />
            </g>
          ) : null}
        </svg>
        {hp ? (
          <p className="tooltip" style={{ left: `${(sx(hp.year) / W) * 100}%` }}>
            <strong>{hp.year}</strong>
            {hp.age !== undefined ? ` · age ${hp.age}` : ""}
            <br />
            {money(hp.value)}
          </p>
        ) : null}
      </div>
      {showAge ? <p className="axis-note">Ages along the bottom · values in today's dollars</p> : null}
      <ul className="events">
        {groups.map((m) => (
          <li key={`row-${m.year}-${m.label}`} className={m.distress ? "soft" : ""}>
            <svg viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true" className={`event ${m.icon === "retirement" ? "event-focus" : ""}`}>
              <circle r={9} />
              <Glyph kind={m.icon} />
            </svg>
            <span>
              <strong>{m.year}</strong> · {m.label}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
