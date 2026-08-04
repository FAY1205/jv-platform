import { describe, it, expect } from "vitest";
import { coerceColorCoding, coerceRetentionDays } from "@/modules/settings/export-settings";

// WS-7g / F-39 + SET-07: coerce the stored settings values with safe defaults (PRN-11).
describe("coerceColorCoding", () => {
  it("defaults ON — only an explicit false disables color coding (SET-01 default true)", () => {
    expect(coerceColorCoding(undefined)).toBe(true);
    expect(coerceColorCoding(null)).toBe(true);
    expect(coerceColorCoding(true)).toBe(true);
    expect(coerceColorCoding(false)).toBe(false);
  });
});

describe("coerceRetentionDays", () => {
  it("defaults to 365 and accepts a positive integer", () => {
    expect(coerceRetentionDays(undefined)).toBe(365);
    expect(coerceRetentionDays(90)).toBe(90);
  });

  it("ignores non-positive / non-integer values, falling back to the default", () => {
    expect(coerceRetentionDays(0)).toBe(365);
    expect(coerceRetentionDays(-5)).toBe(365);
    expect(coerceRetentionDays("nope")).toBe(365);
  });
});
