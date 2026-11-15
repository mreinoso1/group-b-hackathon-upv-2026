// npm run voices: the exact line each future-self recording must say, and which ones exist.
// The bubble on the entry screen shows this same text, so voice and screen always match.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { futureSelves, LocalCaseSource } from "@bite/plan-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = new LocalCaseSource(resolve(root, "cases"));
const publicDir = resolve(root, "packages/web/public");

/** Length of an MPEG-1 Layer III file, read from its frame headers (no decoder needed). */
function mp3Seconds(file: string): number {
  const data = readFileSync(file);
  const rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const hz = [44100, 48000, 32000];
  let i = data.subarray(0, 3).toString() === "ID3" ? 10 + ((data[6]! & 0x7f) << 21 | (data[7]! & 0x7f) << 14 | (data[8]! & 0x7f) << 7 | (data[9]! & 0x7f)) : 0;
  let seconds = 0;
  while (i + 4 <= data.length) {
    const b1 = data[i + 1]!, b2 = data[i + 2]!;
    const ok = data[i] === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 3) & 3) === 3 && ((b1 >> 1) & 3) === 1;
    const br = rates[b2 >> 4] ?? 0, sr = hz[(b2 >> 2) & 3];
    if (!ok || !br || !sr) { i++; continue; }
    seconds += 1152 / sr;
    i += Math.floor((144 * br * 1000) / sr) + ((b2 >> 1) & 1);
  }
  return seconds;
}

let problems = 0;
for (const id of await source.listIds()) {
  for (const f of futureSelves(await source.getCase(id))) {
    const key = `${id}-${f.memberId}`;
    const audio = resolve(publicDir, "audio", `${key}.mp3`);
    const avatar = ["jpg", "png"].map((ext) => resolve(publicDir, "avatars", `${key}.${ext}`)).find(existsSync);
    const words = f.introText.split(/\s+/).length;
    console.log(`\n${f.name}, ${f.age} (${f.reason === "retirement" ? "retirement" : "savings run out"})`);
    // A faithful reading takes 2–3 words a second: much longer means another text was recorded.
    const longest = words / 1.8 + 2;
    const shortest = words / 3.4; // faster than ~3.4 words a second means words are missing
    const seconds = existsSync(audio) ? mp3Seconds(audio) : 0;
    const status = !existsSync(audio)
      ? "✗ missing"
      : seconds > longest
        ? `⚠ ${seconds.toFixed(1)} s, longer than this text (~${Math.round(words / 2.5)} s): re-record it`
        : seconds < shortest
          ? `⚠ ${seconds.toFixed(1)} s, shorter than this text (~${Math.round(words / 2.5)} s): probably an older line, re-record it`
          : `✓ ${seconds.toFixed(1)} s, ${Math.round(statSync(audio).size / 1024)} KB`;
    if (!status.startsWith("✓")) problems++;
    console.log(`  file:   packages/web/public/audio/${key}.mp3  ${status}`);
    console.log(`  avatar: ${avatar ? "✓" : "✗ missing (initials are shown)"}`);
    console.log(`  text (${words} words, ~${Math.round(words / 2.5)} s): ${f.introText}`);
  }
}
console.log("");
console.log(problems ? `${problems} recording(s) missing or to re-record.` : "All recordings match their text.");
