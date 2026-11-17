// "Make it real": the first step and the plan's check-in dates as calendar events (.ics), so the
// future self's reminder reaches the family's own calendar. Only dates and labels the app already
// shows; no figures. One file works with Google Calendar, Outlook and Apple Calendar.

export interface CalendarEvent {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  description: string;
  /** 09:00 local time for the step; all-day for check-ins. */
  allDay: boolean;
}

/** RFC 5545 text: escape backslash, semicolon, comma and newlines. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with CRLF + space (approximated by characters). */
function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? " " : "") + line.slice(i, i + 73));
  return out.join("\r\n");
}

const compact = (iso: string) => iso.replace(/-/g, "");

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A calendar file with one VEVENT per event, each with a reminder alarm. */
export function buildIcs(events: CalendarEvent[], url: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Future You//Sherpas hackathon//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  events.forEach((e, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:future-you-${compact(e.date)}-${i}@future-you`,
      `DTSTAMP:${stamp}`,
      ...(e.allDay
        ? [`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`]
        : [`DTSTART:${compact(e.date)}T090000`, `DTEND:${compact(e.date)}T093000`]),
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(`${e.description}\n\nOpen your plan: ${url}`)}`,
      `URL:${url}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(e.title)}`,
      "TRIGGER:-PT0M",
      "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The month before a plan date, so the check-in arrives while there is still time to act. */
export function monthBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** Starts the download of the .ics file in the browser. */
export function downloadIcs(filename: string, ics: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
