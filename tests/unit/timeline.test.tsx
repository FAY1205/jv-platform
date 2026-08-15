// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Timeline, matchesTimelineFilter, type TimelineEntry } from "@/components/Timeline";

// TSK-06 / WP-TSK-4: the unified timeline — filter-chip mapping (pure) + rendering
// (empty state, note bodies, filtering).

describe("TSK-06: matchesTimelineFilter — system events show under All only", () => {
  it("'all' matches every kind", () => {
    for (const k of ["imported", "routed", "assigned", "status", "note", "task_created", "task_completed"] as const) {
      expect(matchesTimelineFilter(k, "all")).toBe(true);
    }
  });
  it("'tasks' matches task_created and task_completed only", () => {
    expect(matchesTimelineFilter("task_created", "tasks")).toBe(true);
    expect(matchesTimelineFilter("task_completed", "tasks")).toBe(true);
    expect(matchesTimelineFilter("note", "tasks")).toBe(false);
    expect(matchesTimelineFilter("status", "tasks")).toBe(false);
  });
  it("'notes' matches note only", () => {
    expect(matchesTimelineFilter("note", "notes")).toBe(true);
    expect(matchesTimelineFilter("task_created", "notes")).toBe(false);
  });
  it("'status' matches status only", () => {
    expect(matchesTimelineFilter("status", "status")).toBe(true);
    expect(matchesTimelineFilter("note", "status")).toBe(false);
  });
  it("system events (imported/routed/assigned) never match a specific chip — All only", () => {
    for (const k of ["imported", "routed", "assigned"] as const) {
      expect(matchesTimelineFilter(k, "tasks")).toBe(false);
      expect(matchesTimelineFilter(k, "notes")).toBe(false);
      expect(matchesTimelineFilter(k, "status")).toBe(false);
    }
  });
});

const ENTRIES: TimelineEntry[] = [
  { kind: "task_created", at: "2026-08-15T09:14:00.000Z", label: 'Task added — "Send comps"', actor: "faisal@example.com", title: "Send comps" },
  { kind: "note", at: "2026-08-14T16:02:00.000Z", label: "Note added", actor: "faisal@example.com", body: "Seller motivated." },
  { kind: "status", at: "2026-08-12T14:41:00.000Z", label: "Status changed New → Contacted", actor: "faisal@example.com", status: "Contacted" },
  { kind: "routed", at: "2026-08-12T08:00:00.000Z", label: "Routed to Cedar Ridge Capital (JV-004)", actor: null },
  { kind: "imported", at: "2026-08-12T07:58:00.000Z", label: "Imported from Lead Source 1", actor: null },
];

describe("DSN-03: Timeline rendering", () => {
  it("shows an empty state when there is no activity at all", () => {
    render(<Timeline activity={[]} />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("renders every entry under 'All', including system events", () => {
    render(<Timeline activity={ENTRIES} />);
    expect(screen.getByText(/task added/i)).toBeInTheDocument();
    expect(screen.getByText(/note added/i)).toBeInTheDocument();
    expect(screen.getByText(/status changed/i)).toBeInTheDocument();
    expect(screen.getByText(/routed to cedar ridge/i)).toBeInTheDocument();
    expect(screen.getByText(/imported from lead source 1/i)).toBeInTheDocument();
    // A note body renders as plain text, never HTML (PRN-10).
    expect(screen.getByText("Seller motivated.")).toBeInTheDocument();
  });

  it("the Tasks chip narrows to task_created/task_completed and drops system + note + status entries", async () => {
    const user = userEvent.setup();
    render(<Timeline activity={ENTRIES} />);
    const group = screen.getByRole("group", { name: /filter timeline/i });
    await user.click(within(group).getByRole("button", { name: /^tasks$/i }));

    expect(screen.getByText(/task added/i)).toBeInTheDocument();
    expect(screen.queryByText(/note added/i)).toBeNull();
    expect(screen.queryByText(/status changed/i)).toBeNull();
    expect(screen.queryByText(/routed to cedar ridge/i)).toBeNull();
    expect(screen.queryByText(/imported from lead source 1/i)).toBeNull();
  });

  it("a filter that matches nothing shows its own empty message, not the global one", async () => {
    const user = userEvent.setup();
    render(<Timeline activity={[ENTRIES[3], ENTRIES[4]]} />); // routed + imported only — no notes
    const group = screen.getByRole("group", { name: /filter timeline/i });
    await user.click(within(group).getByRole("button", { name: /^notes$/i }));
    expect(screen.getByText(/nothing matches this filter/i)).toBeInTheDocument();
  });
});
