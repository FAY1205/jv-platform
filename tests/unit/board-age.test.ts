import { describe, it, expect } from "vitest";
import { boardAge, BOARD_COLUMNS, BOARD_PAGE_SIZE, STALE_DAYS } from "@/modules/leads/board";

// WP-KAN-1 · KAN-03: the ONE pure age helper behind every card's "Nd in status" label
// and its stale (amber ⚠) flag. `now` is injected — no Date.now() anywhere in the
// module layer — so the boundary is deterministic.

const NOW = new Date("2026-08-15T12:00:00.000Z");
/** `d` days (and optional hours) BEFORE NOW, as the ISO string a card carries. */
const daysAgo = (d: number, hours = 0) => new Date(NOW.getTime() - d * 86_400_000 - hours * 3_600_000).toISOString();

describe("KAN-03: boardAge", () => {
  it("KAN-03: counts whole days in status and labels them", () => {
    expect(boardAge(daysAgo(3), NOW)).toMatchObject({ days: 3, stale: false, label: "3d in status" });
    expect(boardAge(daysAgo(1), NOW).label).toBe("1d in status");
  });

  it("KAN-03: a same-day change reads 0 days with its own label", () => {
    expect(boardAge(daysAgo(0, 5), NOW)).toMatchObject({ days: 0, stale: false, label: "In status today" });
    expect(boardAge(NOW.toISOString(), NOW).days).toBe(0);
  });

  it("KAN-03: the stale boundary is exactly STALE_DAYS (14) — 13d fresh, 14d stale", () => {
    expect(STALE_DAYS).toBe(14);
    // Just under the boundary: 13d 23h is still 13 whole days.
    expect(boardAge(daysAgo(13, 23), NOW)).toMatchObject({ days: 13, stale: false });
    // Exactly 14 days flips it.
    expect(boardAge(daysAgo(14), NOW)).toMatchObject({ days: 14, stale: true, label: "14d in status" });
    expect(boardAge(daysAgo(22), NOW)).toMatchObject({ days: 22, stale: true });
  });

  it("KAN-03: a future or unparseable timestamp degrades to day 0, never negative or NaN", () => {
    expect(boardAge(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toMatchObject({ days: 0, stale: false });
    expect(boardAge("not-a-date", NOW)).toMatchObject({ days: 0, stale: false, label: "In status today" });
  });

  it("KAN-03: is pure — the same inputs always give the same answer", () => {
    const a = boardAge(daysAgo(7), NOW);
    const b = boardAge(daysAgo(7), NOW);
    expect(a).toEqual(b);
  });
});

describe("KAN-02: board constants", () => {
  it("KAN-02: the six fixed columns are the seeded status vocabulary, in workflow order", () => {
    expect([...BOARD_COLUMNS]).toEqual(["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"]);
  });

  it("KAN-02: the per-column page size is 25", () => {
    expect(BOARD_PAGE_SIZE).toBe(25);
  });
});
