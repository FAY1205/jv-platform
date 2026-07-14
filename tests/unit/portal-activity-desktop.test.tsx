// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-PW-4 Task 1: the desktop (>= lg) Activity table. `useIsDesktop` is mocked true so
// the page gate mounts ActivityDesktop (not the mobile card list) — proves the wiring
// in page.tsx, not just the child component in isolation.

const ACTIVITY_PAGE = {
  items: [
    { when: "2026-07-10T12:00:00.000Z", kind: "status", detail: "Marked Contacted" },
    { when: "2026-07-09T09:30:00.000Z", kind: "note", detail: "Left a voicemail" },
  ],
  page: 1,
  pageSize: 2, // matches items.length so Next is enabled
};

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ACTIVITY_PAGE) }));
vi.mock("@/lib/use-media-query", () => ({ useIsDesktop: () => true }));

import { apiGet } from "@/lib/api";
import PortalActivityPage from "@/app/portal/activity/page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalActivityPage />
    </QueryClientProvider>,
  );
}

function lastCallUrl(): string {
  const calls = vi.mocked(apiGet).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe("WP-PW-4 Task 1 ActivityDesktop (table)", () => {
  it("PW4-01: renders the table with both items' details, kind badges, and a timestamp", async () => {
    renderPage();
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("Marked Contacted")).toBeTruthy();
    expect(screen.getByText("Left a voicemail")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
    expect(screen.getByText(new Date(ACTIVITY_PAGE.items[0].when).toLocaleString())).toBeTruthy();
  });

  it("PW4-02: Next is enabled on a full page, then disabled once the next page is short", async () => {
    renderPage();
    await screen.findByRole("table");
    // page 1: items.length (2) === pageSize (2) -> pager shows, Next enabled.
    const next = screen.getByRole("button", { name: /next/i });
    expect((next as HTMLButtonElement).disabled).toBe(false);

    // page 2: fewer items than pageSize -> pager still shows (page > 1), Next disabled.
    vi.mocked(apiGet).mockResolvedValueOnce({
      items: [{ when: "2026-07-08T08:00:00.000Z", kind: "note", detail: "Only one left" }],
      page: 2,
      pageSize: 2,
    });
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText("Only one left")).toBeTruthy());
    expect((screen.getByRole("button", { name: /next/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("PW4-03: clicking Next refetches with page=2", async () => {
    renderPage();
    await screen.findByRole("table");
    vi.mocked(apiGet).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(lastCallUrl()).toContain("page=2");
  });
});
