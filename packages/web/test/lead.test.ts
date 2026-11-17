import { describe, expect, it } from "vitest";
import { splitLead } from "../src/components/CapsuleCard.tsx";

describe("one sentence first", () => {
  it("leads with the first sentence and keeps the rest", () => {
    const { lead, rest } = splitLead("You're starting from a strong position: about $247,000 in total assets. You're capturing that match in full.");
    expect(lead).toBe("You're starting from a strong position: about $247,000 in total assets.");
    expect(rest).toBe("You're capturing that match in full.");
  });

  it("takes two sentences when the first is very short", () => {
    expect(splitLead("Short one. Then a second sentence here that is longer. And a third.").lead).toBe("Short one. Then a second sentence here that is longer.");
  });

  it("never splits inside bold text or without an ending", () => {
    expect(splitLead("**Bold. start** then more. Next.").rest).toBe("");
    expect(splitLead("No end punctuation here").lead).toBe("No end punctuation here");
  });

  it("keeps every word of the plan: lead + rest is the original text", () => {
    const text = "A first sentence that is long enough to lead. A second one. A third one.";
    const { lead, rest } = splitLead(text);
    expect(`${lead} ${rest}`).toBe(text);
  });
});
