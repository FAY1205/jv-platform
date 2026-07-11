import { describe, expect, it } from "vitest";
import { formatWaiting } from "@/lib/waiting";

const now = Date.UTC(2026, 6, 11, 0, 0, 0); // 2026-07-11T00:00:00Z

describe("formatWaiting (ASN-03)", () => {
  it("ASN-03: sub-48h shows hours", () => {
    expect(formatWaiting(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h");
  });
  it("ASN-03: 48h+ shows days to one decimal", () => {
    expect(formatWaiting(new Date(now - 4.2 * 86_400_000).toISOString(), now)).toBe("4.2d");
  });
  it("ASN-03: exactly 48h flips to days", () => {
    expect(formatWaiting(new Date(now - 48 * 3_600_000).toISOString(), now)).toBe("2d");
  });
  it("ASN-03: future/zero clamps to 0h", () => {
    expect(formatWaiting(new Date(now + 3_600_000).toISOString(), now)).toBe("0h");
  });
});
