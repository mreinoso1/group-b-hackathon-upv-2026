import { describe, expect, it } from "vitest";
import { checkNumbers, extractNumbers, roundedAmount } from "../src/index.ts";

describe("rounded amounts for I'm lost", () => {
  const r = (raw: string) => roundedAmount(raw, extractNumbers(raw)[0]!.value);

  it("rounds big or exact dollar amounts a person would not remember", () => {
    expect(r("$171,055.83")).toBe(171000);
    expect(r("$6,418.40")).toBe(6418);
    expect(r("$62,932")).toBe(63000);
  });

  it("leaves round amounts, percentages, years and scaled figures alone", () => {
    expect(r("$300,000")).toBeNull();
    expect(r("$6,418")).toBeNull();
    expect(r("93%")).toBeNull();
    expect(r("2044")).toBeNull();
    expect(r("$750k")).toBeNull();
  });

  it("the guard accepts the rounded form only when it is listed", () => {
    const plan = [171055.83];
    expect(checkNumbers("about $171,000 a year", plan).ok).toBe(false);
    expect(checkNumbers("about $171,000 a year", [...plan, r("$171,055.83")!]).ok).toBe(true);
  });
});
