import { describe, it, expect } from "vitest";
import {
  SEED_LEAD_STATUSES,
  isValidStatus,
  currentStatus,
  DEFAULT_STATUS,
} from "@/modules/portal/statuses";

// SEAM-06: seeded status vocabulary; PTL-03: a lead's current status is the latest
// history entry (default when none). Pure helpers.
describe("SEAM-06 / PTL-03: lead statuses", () => {
  it("accepts a seeded status and rejects anything else", () => {
    expect(isValidStatus("Contacted")).toBe(true);
    expect(isValidStatus(SEED_LEAD_STATUSES[0])).toBe(true);
    expect(isValidStatus("Bogus")).toBe(false);
    expect(isValidStatus("")).toBe(false);
  });

  it("defaults to New when there is no history", () => {
    expect(currentStatus([])).toBe(DEFAULT_STATUS);
    expect(DEFAULT_STATUS).toBe("New");
  });

  it("returns the latest status by timestamp regardless of input order", () => {
    const history = [
      { status: "New", createdAt: "2026-07-01T00:00:00.000Z" },
      { status: "Closed", createdAt: "2026-07-03T00:00:00.000Z" },
      { status: "Contacted", createdAt: "2026-07-02T00:00:00.000Z" },
    ];
    expect(currentStatus(history)).toBe("Closed");
  });
});
