import { describe, expect, it } from "vitest";
import { joinTarget, joinUrl, newRoom, roomFrom, withRoom } from "../src/room.ts";

describe("demo rooms", () => {
  it("reads a 4-letter room from the address, in any case, and ignores anything else", () => {
    expect(roomFrom("?room=kqzt")).toBe("KQZT");
    expect(roomFrom("?case=x&room=KQZT&member=y")).toBe("KQZT");
    expect(roomFrom("?room=KQZ")).toBeNull();
    expect(roomFrom("?room=KQ1T")).toBeNull();
    expect(roomFrom("")).toBeNull();
  });

  it("adds the room to family-data calls only", () => {
    expect(withRoom("/api/cases/weah/consent", "KQZT")).toBe("/api/cases/weah/consent?room=KQZT");
    expect(withRoom("/api/cases/weah/first-step?member=melanie", "KQZT")).toBe("/api/cases/weah/first-step?member=melanie&room=KQZT");
    expect(withRoom("/api/cases/weah/consent", null)).toBe("/api/cases/weah/consent");
    expect(withRoom("/api/audio/abc", "KQZT")).toBe("/api/audio/abc");
  });

  it("reads and builds join links", () => {
    const url = joinUrl("http://192.168.1.20:5173", "timothy-melanie-weah", "melanie", "KQZT");
    expect(url).toBe("http://192.168.1.20:5173/join?case=timothy-melanie-weah&member=melanie&room=KQZT");
    const u = new URL(url);
    expect(joinTarget(u.pathname, u.search)).toEqual({ caseId: "timothy-melanie-weah", member: "melanie" });
    expect(roomFrom(u.search)).toBe("KQZT");
    expect(joinTarget("/", u.search)).toBeNull();
    expect(joinTarget("/join", "?case=../etc&member=melanie")).toBeNull();
  });

  it("makes 4-letter codes without vowels", () => {
    for (let i = 0; i < 50; i++) expect(newRoom()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(newRoom(() => 0)).toBe("BBBB");
  });
});
