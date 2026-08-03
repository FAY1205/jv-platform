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
  pageSize: 20,
  total: 45, // > one page, so the shared Pagination shows and "Next page" is enabled
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

  it("PW4-02 + WP-PP-5: the shared Pagination shows a real total and enables Next when more pages exist", async () => {
    renderPage();
    await screen.findByRole("table");
    // total 45 > pageSize 20 → "Next page" enabled (3 pages).
    const next = screen.getByRole("button", { name: /next page/i });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    // The shared control shows the "of {total}" range, unlike the old prev/next pager.
    expect(screen.getByText(/of 45/)).toBeTruthy();
  });

  it("PW4-03 + WP-PP-5: clicking Next page refetches with page=2 (and carries pageSize)", async () => {
    renderPage();
    await screen.findByRole("table");
    vi.mocked(apiGet).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(lastCallUrl()).toContain("page=2");
    expect(lastCallUrl()).toContain("pageSize=20");
  });
});
