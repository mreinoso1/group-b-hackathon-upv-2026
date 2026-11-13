import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { futureSelf, futureSelves, LocalCaseSource } from "../src/index.ts";

const CASES = fileURLToPath(new URL("../../../cases", import.meta.url));
const source = new LocalCaseSource(CASES);
const TODAY = new Date("2026-11-13");

describe("futureSelf", () => {
  it("Michael speaks from 85, the last year with savings", async () => {
    const f = futureSelf(await source.getCase("michael-carter"), "michael", TODAY)!;
    expect(f).toMatchObject({ age: 85, year: 2074, reason: "savings_run_out" });
    expect(f.introText).toContain("85");
    expect(f.checkIns.map((c) => c.type)).toContain("PURCHASE");
  });

  it("Samantha speaks from 73, despite a score of 82", async () => {
    const f = futureSelf(await source.getCase("samantha-lewis"), "samantha", TODAY)!;
    expect(f).toMatchObject({ age: 73, year: 2052, reason: "savings_run_out" });
  });

  it("couples without a shortfall get one future self each, at retirement", async () => {
    const weah = futureSelves(await source.getCase("timothy-melanie-weah"), TODAY);
    expect(weah.map((f) => [f.name, f.age, f.reason])).toEqual([
      ["Timothy", 62, "retirement"],
      ["Melanie", 60, "retirement"],
    ]);
  });

  it("every age in the intro comes from the plan", async () => {
    for (const id of await source.listIds()) {
      for (const f of futureSelves(await source.getCase(id), TODAY)) {
        expect(f.introText).toContain(String(f.age));
        expect(f.age).toBeGreaterThan(f.ageNow);
      }
    }
  });
});
