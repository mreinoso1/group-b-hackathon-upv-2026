import { describe, expect, it } from "vitest";
import { isPublicHost } from "../src/components/Demo.tsx";

describe("demo page QR address", () => {
  it("uses the page's own address when published", () => {
    expect(isPublicHost("future-you-g1ew.onrender.com")).toBe(true);
  });
  it("uses the laptop's Wi-Fi address when running locally", () => {
    for (const h of ["localhost", "127.0.0.1", "192.168.1.20", "10.0.0.5", "172.20.1.2", "mylaptop.local"]) expect(isPublicHost(h)).toBe(false);
  });
});
