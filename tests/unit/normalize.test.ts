import { describe, expect, it } from "vitest";
import {
  normalizeZip,
  normalizePhone,
  normalizeState,
  normalizeAddress,
  computeDedupeKey,
} from "@/modules/pipeline/normalize";

describe("NRM-01: ZIP normalization", () => {
  it("left-pads dropped leading zeros to 5 digits", () => {
    expect(normalizeZip("6404")).toBe("06404");
    expect(normalizeZip(6404)).toBe("06404");
    expect(normalizeZip("8034")).toBe("08034");
    expect(normalizeZip("29601")).toBe("29601");
  });

  it("takes the first 5 digits of a ZIP+4", () => {
    expect(normalizeZip("06404-1234")).toBe("06404");
    expect(normalizeZip("29601-0002")).toBe("29601");
  });

  it("TST-03: 6404 and 06404-1234 normalize to the same ZIP", () => {
    expect(normalizeZip("6404")).toBe(normalizeZip("06404-1234"));
  });

  it("returns empty for missing/garbage input", () => {
    expect(normalizeZip("")).toBe("");
    expect(normalizeZip(null)).toBe("");
    expect(normalizeZip("n/a")).toBe("");
  });
});

describe("NRM-02: phone normalization", () => {
  it("reduces to digits-only last 10", () => {
    expect(normalizePhone("(856) 555-0142")).toBe("8565550142");
    expect(normalizePhone("1-856-555-0142")).toBe("8565550142");
    expect(normalizePhone("+1 (856) 555.0142")).toBe("8565550142");
  });
});

describe("NRM-02: state normalization", () => {
  it("accepts 2-letter codes (any case)", () => {
    expect(normalizeState("nj")).toBe("NJ");
    expect(normalizeState("SC")).toBe("SC");
  });

  it("maps full names to codes", () => {
    expect(normalizeState("New Jersey")).toBe("NJ");
    expect(normalizeState("south carolina")).toBe("SC");
    expect(normalizeState("N.J.")).toBe("NJ");
  });

  it("returns empty for unknown states", () => {
    expect(normalizeState("Ontario")).toBe("");
    expect(normalizeState("ZZ")).toBe("");
    expect(normalizeState("")).toBe("");
  });
});

describe("NRM-02: address normalization for dedupe", () => {
  it("collapses case, punctuation, and whitespace", () => {
    expect(normalizeAddress("142 Garden State Ave.")).toBe("142 garden state ave");
    expect(normalizeAddress("142   GARDEN   state   ave")).toBe("142 garden state ave");
  });

  it("TST-04: same address in different case/punctuation yields the same dedupe key", () => {
    const a = computeDedupeKey("142 Garden State Ave.", "8034");
    const b = computeDedupeKey("142  garden state ave", "08034-0000");
    expect(a).toBe(b);
  });

  it("different address or ZIP yields a different key", () => {
    expect(computeDedupeKey("142 Garden State Ave", "08034")).not.toBe(
      computeDedupeKey("143 Garden State Ave", "08034"),
    );
    expect(computeDedupeKey("142 Garden State Ave", "08034")).not.toBe(
      computeDedupeKey("142 Garden State Ave", "08035"),
    );
  });
});
