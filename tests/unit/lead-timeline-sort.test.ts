import { describe, it, expect } from "vitest";
import { sortNewestFirst, TIMELINE_STREAM_LIMIT, type LeadActivity } from "@/modules/leads/timeline";

// TSK-06: the timeline's ONE ordering rule, unit-tested away from the database. The
// merge itself is proven live in tests/integration/lead-timeline.test.ts; this pins the
// ordering contract the assembly depends on (and the tie-break the UI relies on).

const at = (iso: string, kind: LeadActivity["kind"] = "note", label = "x"): LeadActivity => ({ kind, at: iso, label, actor: null });

describe("TSK-06: timeline ordering", () => {
  it("TSK-06: sortNewestFirst orders mixed entry kinds newest first", () => {
    const entries: LeadActivity[] = [
      at("2026-08-01T10:00:00.000Z", "imported", "Imported"),
      at("2026-08-05T09:30:00.000Z", "task_completed", "Task completed"),
      at("2026-08-03T12:00:00.000Z", "note", "Note added"),
      at("2026-08-04T08:00:00.000Z", "status", "Status set to Contacted"),
      at("2026-08-02T23:59:59.000Z", "task_created", "Task added"),
    ];
    expect(sortNewestFirst(entries).map((e) => e.at)).toEqual([
      "2026-08-05T09:30:00.000Z",
      "2026-08-04T08:00:00.000Z",
      "2026-08-03T12:00:00.000Z",
      "2026-08-02T23:59:59.000Z",
      "2026-08-01T10:00:00.000Z",
    ]);
  });

  it("TSK-06: entries sharing a timestamp keep their insertion order (stable)", () => {
    // Same-instant entries are real: a task created and completed by a script, or a note
    // and a status change inside one transaction. The assembly appends system events,
    // then status, then notes/tasks — that order must survive the sort rather than
    // shuffling between requests (the UI has no secondary key to fall back on).
    const same = "2026-08-06T00:00:00.000Z";
    const entries: LeadActivity[] = [
      at(same, "imported", "first"),
      at(same, "status", "second"),
      at(same, "note", "third"),
      at("2026-08-07T00:00:00.000Z", "note", "newest"),
      at(same, "task_created", "fourth"),
    ];
    expect(sortNewestFirst(entries).map((e) => e.label)).toEqual(["newest", "first", "second", "third", "fourth"]);
  });

  it("TSK-06: sorting is in place and returns the same array (one timeline, not a copy)", () => {
    const entries: LeadActivity[] = [at("2026-08-01T00:00:00.000Z"), at("2026-08-02T00:00:00.000Z")];
    const result = sortNewestFirst(entries);
    expect(result).toBe(entries);
    expect(entries[0].at).toBe("2026-08-02T00:00:00.000Z");
  });

  it("TSK-06: the per-stream cap is a bounded, positive window", () => {
    // A guard on the payload bound itself: if this is ever raised to something unbounded,
    // the lead-detail response stops being size-bounded (FEP).
    expect(TIMELINE_STREAM_LIMIT).toBeGreaterThan(0);
    expect(TIMELINE_STREAM_LIMIT).toBeLessThanOrEqual(200);
  });
});
