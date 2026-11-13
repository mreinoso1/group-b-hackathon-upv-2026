import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  buildExplainPrompt,
  checkNumbers,
  checkPeople,
  extractNumbers,
  fallbackSimple,
  LocalCaseSource,
  sanitizeModelText,
  styleFor,
} from "../src/index.ts";

const source = new LocalCaseSource(fileURLToPath(new URL("../../../cases", import.meta.url)));
const weah = await source.getCase("timothy-melanie-weah");
const carter = await source.getCase("michael-carter");

describe("extractNumbers", () => {
  it("normalises money, percentages and scales", () => {
    const n = extractNumbers("You have $140,000 against $750k, 18% on $18,000, $1.25M in 2030, and $60,222.50 spare.").map((m) => m.value);
    expect(n).toEqual([140000, 750000, 18, 18000, 1250000, 2030, 60222.5]);
  });
  it("ignores digits inside words", () => {
    expect(extractNumbers("401(k) and a 529 plan")).toHaveLength(2);
    expect(extractNumbers("covid19 abc2def")).toHaveLength(0);
  });
});

describe("checkNumbers", () => {
  const allowed = allowedNumbers(["Timothy has $140,000 of life insurance against a recommended minimum of $750,000."]);
  it("accepts numbers copied from the plan, in any spelling", () => {
    expect(checkNumbers("Like an umbrella that covers $140,000 of a $750k storm.", allowed).ok).toBe(true);
  });
  it("rejects rounded or invented numbers", () => {
    const r = checkNumbers("You have about $150,000, roughly 19% of what you need.", allowed);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["$150,000", "19%"]);
  });
  it("lets small structural numbers through", () => {
    expect(checkNumbers("Two steps: 1 check, 2 decide.", allowed).ok).toBe(true);
  });
});

describe("checkPeople", () => {
  it("rejects people the plan text does not mention", () => {
    const debt = buildExplainPrompt(weah, "advice.debt", "timothy", 0);
    expect(debt.people.allowed).toEqual(["Timothy"]);
    const r = checkPeople("Melanie has the mortgage and student loan.", debt.people.allowed, debt.people.household);
    expect(r).toEqual({ ok: false, unknown: ["Melanie"] });
    expect(checkPeople("Timothy, the card is the costly one.", debt.people.allowed, debt.people.household).ok).toBe(true);
  });
  it("allows partners and children the plan text names", () => {
    const life = buildExplainPrompt(weah, "advice.protection.life_insurance", "melanie", 0);
    expect(life.people.allowed).toEqual(expect.arrayContaining(["Melanie", "Timothy", "Liam", "Josh"]));
  });
});

describe("sanitizeModelText", () => {
  it("strips html, links, code and headings", () => {
    const t = sanitizeModelText('# Hi\n<script>alert(1)</script>See [this](http://x.y) and `code` https://evil.example now.');
    expect(t).not.toMatch(/<|>|\]\(|http|#/);
    expect(t).toContain("See this and code");
  });
  it("cuts long text at a sentence", () => {
    const t = sanitizeModelText("A short sentence. ".repeat(80), 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith(".")).toBe(true);
  });
});

describe("explain prompt", () => {
  it("allows exactly the numbers in the capsule's plan text", () => {
    const p = buildExplainPrompt(weah, "advice.protection.life_insurance", "melanie", 0);
    expect(p.allowed).toContain(110000);
    expect(p.allowed).toContain(600000);
    expect(p.allowed).not.toContain(235000); // a figure from another part of the plan
    expect(p.messages[1]!.content).toContain("ALLOWED NUMBERS:");
  });
  it("writes to the person, in their tone, without exposing persona labels", () => {
    const p = buildExplainPrompt(weah, "advice.protection.life_insurance", "melanie", 0);
    expect(p.audience).toBe("Melanie");
    expect(p.messages[0]!.content).toMatch(/Voice: reassuring, steady/);
    const all = p.messages.map((m) => m.content).join("\n");
    expect(all).not.toMatch(/COLLABORATOR|MISALIGNED|D4|D5/);
    const t = buildExplainPrompt(weah, "advice.debt", "timothy", 0);
    expect(t.messages[0]!.content).toMatch(/Voice: confident, forward-looking/);
  });
  it("addresses both partners when reading together, and one person in solo cases", () => {
    expect(buildExplainPrompt(weah, "advice.debt", "together", 0).audience).toBe("Timothy and Melanie");
    expect(buildExplainPrompt(carter, "advice.debt", "michael", 0).audience).toBe("Michael");
  });
  it("never invents a partner for people who live alone, and keeps partners' figures theirs", () => {
    const solo = buildExplainPrompt(carter, "advice.retirement", "michael", 0).messages[0]!.content;
    expect(solo).toMatch(/do not mention a partner/);
    expect(solo.match(/partner/g)).toHaveLength(1); // only the rule itself
    const melanie = buildExplainPrompt(weah, "advice.protection.life_insurance", "melanie", 0).messages[0]!.content;
    expect(melanie).toMatch(/Lead with what is about Melanie/);
    const user = buildExplainPrompt(weah, "advice.protection.life_insurance", "melanie", 0).messages[1]!.content;
    expect(user.indexOf("About you (Melanie):")).toBeLessThan(user.indexOf("About Timothy (not the reader):"));
    expect(user).toContain("About you (Melanie):\n- Melanie has $110,000");
  });
  it("tries another way in on each new 'I'm lost'", () => {
    expect([0, 1, 2, 7].map(styleFor)).toEqual(["analogy", "steps", "one_number", "one_number"]);
  });
});

describe("fallbackSimple", () => {
  it("prefers the sentence about the person reading", () => {
    const words = [{ text: "Timothy has $140,000 of cover. Melanie has $110,000 against $600,000.", source: "x" }];
    expect(fallbackSimple(words, "Melanie")[0]!.text).toBe("Melanie has $110,000 against $600,000.");
    expect(fallbackSimple(words)[0]!.text).toBe("Timothy has $140,000 of cover.");
  });
});
