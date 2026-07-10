import { describe, it, expect } from "vitest";
import { groupByDay } from "@/lib/notification-groups";

// WS-7f: the notification center groups items by calendar day (Today / Yesterday / date).
// Pure over a passed-in `now` so it's deterministic. Local-time construction + grouping
// round-trip, so this is TZ-independent.

const now = new Date(2026, 6, 10, 12, 0, 0); // Jul 10 2026, local
const iso = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString();
const n = (id: string, at: string) => ({ id, createdAt: at });

describe("groupByDay (NTF-04)", () => {
  it("NTF-04: buckets into Today / Yesterday / older, preserving item order", () => {
    const groups = groupByDay(
      [n("a", iso(2026, 6, 10, 9)), n("b", iso(2026, 6, 10, 8)), n("c", iso(2026, 6, 9, 20)), n("d", iso(2026, 6, 1))],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", expect.any(String)]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["d"]);
    expect(groups[2].label).not.toBe("Today");
    expect(groups[2].label).not.toBe("Yesterday");
  });

  it("NTF-04: returns a single Today group when everything is from today", () => {
    const groups = groupByDay([n("a", iso(2026, 6, 10, 9)), n("b", iso(2026, 6, 10, 1))], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("returns [] for no items", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
