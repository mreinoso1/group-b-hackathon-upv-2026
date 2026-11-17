import { describe, expect, it } from "vitest";
import { buildIcs, icsText, monthBefore } from "../src/calendar.ts";

describe("calendar file", () => {
  const ics = buildIcs(
    [
      { date: "2026-11-20", title: "Your future self: get umbrella coverage", description: "You told yourself you'd do this today.", allDay: false },
      { date: "2026-12-01", title: "Future You check-in: before your home purchase", description: "Before your home purchase · Jan 2027", allDay: true },
    ],
    "http://localhost:5173",
    new Date("2026-11-16T22:00:00Z"),
  );

  it("is a valid calendar with one event per date and CRLF lines", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART:20261120T090000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201");
    expect(ics).toContain("DTEND;VALUE=DATE:20261202");
  });

  it("escapes commas, semicolons and newlines in text", () => {
    expect(icsText("a, b; c\nd")).toBe("a\\, b\\; c\\nd");
  });

  it("puts a check-in a month before the plan date", () => {
    expect(monthBefore("2027-01-15")).toBe("2026-12-15");
  });
});
