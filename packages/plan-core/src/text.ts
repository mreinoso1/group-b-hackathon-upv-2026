/** Splits a plan narrative into its bullets ("- ...") or, if it has none, its paragraphs. */
export function splitBullets(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bullets: string[] = [];
  let current: string | null = null;
  let sawBullet = false;
  for (const line of lines) {
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m) {
      sawBullet = true;
      if (current !== null) bullets.push(current.trim());
      current = m[1]!;
    } else if (line.trim() === "") {
      if (current !== null) bullets.push(current.trim());
      current = null;
    } else {
      current = current === null ? line : `${current} ${line.trim()}`;
    }
  }
  if (current !== null) bullets.push(current.trim());
  const out = bullets.filter(Boolean);
  return sawBullet ? out : out.length ? out : [text.trim()];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Spoken pace of ~150 words a minute. */
export function readSeconds(texts: string[]): number {
  const words = texts.reduce((n, t) => n + wordCount(t), 0);
  return Math.max(10, Math.round((words / 150) * 60));
}

/** First sentence of a text, keeping decimals such as "$5,250.10" intact. */
export function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1]! : text).trim();
}

/** Takes bullets from the start until the word budget is used; always at least one. */
export function takeWithin(bullets: string[], maxWords: number): string[] {
  const out: string[] = [];
  let words = 0;
  for (const b of bullets) {
    const w = wordCount(b);
    if (out.length > 0 && words + w > maxWords) break;
    out.push(b);
    words += w;
  }
  return out;
}

/** Section of a markdown text under a "## Heading", as bullets. */
export function markdownSection(text: string, heading: string): string[] {
  const parts = text.split(/^##\s+/m);
  const hit = parts.find((p) => p.toLowerCase().startsWith(heading.toLowerCase()));
  if (!hit) return [];
  return splitBullets(hit.slice(hit.indexOf("\n") + 1));
}
