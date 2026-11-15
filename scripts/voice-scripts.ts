// npm run voices: the exact line each future-self recording must say, and which ones exist.
// The bubble on the entry screen shows this same text, so voice and screen always match.
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { futureSelves, LocalCaseSource } from "@bite/plan-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = new LocalCaseSource(resolve(root, "cases"));
const publicDir = resolve(root, "packages/web/public");

for (const id of await source.listIds()) {
  for (const f of futureSelves(await source.getCase(id))) {
    const key = `${id}-${f.memberId}`;
    const audio = resolve(publicDir, "audio", `${key}.mp3`);
    const avatar = ["jpg", "png"].map((ext) => resolve(publicDir, "avatars", `${key}.${ext}`)).find(existsSync);
    const words = f.introText.split(/\s+/).length;
    console.log(`\n${f.name}, ${f.age} (${f.reason === "retirement" ? "retirement" : "savings run out"})`);
    console.log(`  file:   packages/web/public/audio/${key}.mp3  ${existsSync(audio) ? `✓ ${Math.round(statSync(audio).size / 1024)} KB` : "✗ missing"}`);
    console.log(`  avatar: ${avatar ? "✓" : "✗ missing (initials are shown)"}`);
    console.log(`  text (${words} words, ~${Math.round(words / 2.5)} s): ${f.introText}`);
  }
}
