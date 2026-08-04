// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-PW-3 Task 2: the desktop (>= lg) sortable/filterable/paginated partner Leads table.
// `useIsDesktop` is mocked true so the page gate mounts LeadsDesktop (not the mobile card
// list) — proves the wiring in page.tsx, not just the child component in isolation.

const LEADS_PAGE = {
  leads: [
    { refId: "JV-2001", sellerFirst: "Ana", sellerLast: "Ruiz", address: "12 Elm St", city: "Austin", state: "TX", zip: "78701", receivedAt: "2026-07-10T00:00:00.000Z", status: "New", previouslyMatched: false },
    { refId: "JV-2002", sellerFirst: "Bo", sellerLast: "Kim", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-07-09T00:00:00.000Z", status: "Contacted", previouslyMatched: true },
  ],
  page: 1,
  pageSize: 20,
  total: 45, // > one page's worth, so Pagination's "Next page" button is enabled
};

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => LEADS_PAGE) }));
vi.mock("@/lib/use-media-query", () => ({ useIsDesktop: () => true }));

import { apiGet } from "@/lib/api";
import PortalLeadsPage from "@/app/portal/leads/page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalLeadsPage />
    </QueryClientProvider>,
  );
}

function lastCallUrl(): string {
  const calls = vi.mocked(apiGet).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe("WP-PW-3 Task 2 LeadsDesktop (sortable, filterable, paginated table)", () => {
  it("PW3-02: renders the desktop table with the mocked lead refs", async () => {
    renderPage();
    expect(await screen.findByText("JV-2001")).toBeTruthy();
    expect(screen.getByText("JV-2002")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("PW3-02: clicking a sortable Th re-requests with the new sort/dir", async () => {
    renderPage();
    await screen.findByText("JV-2001");
    vi.mocked(apiGet).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /city/i }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const url = lastCallUrl();
    expect(url).toContain("sort=city");
    expect(url).toContain("dir=asc");
  });

  it("PW3-02: toggling sort direction on the active column flips asc/desc", async () => {
    renderPage();
    await screen.findByText("JV-2001");

    fireEvent.click(screen.getByRole("button", { name: /city/i })); // city, default asc
    await waitFor(() => expect(lastCallUrl()).toContain("sort=city"));
    await screen.findByText("JV-2001"); // wait for the re-fetched table to settle (not the loading skeleton)
    vi.mocked(apiGet).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /city/i })); // same column again -> flips
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(lastCallUrl()).toContain("dir=desc");
  });

  it("PP-3: typing in the search box re-requests with q= (debounced) and resets to page 1", async () => {
    renderPage();
    await screen.findByText("JV-2001");

    // Move off page 1 first, so we can prove the search commit resets it.
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(lastCallUrl()).toContain("page=2"));

    vi.mocked(apiGet).mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: /search your leads/i }), { target: { value: "Ruiz" } });

    // 300ms debounce — waitFor rides the default 5s asyncUtilTimeout.
    await waitFor(() => expect(lastCallUrl()).toContain("q=Ruiz"));
    expect(lastCallUrl()).toContain("page=1");
  });

  it("PW3-02: selecting a status filter includes status= and resets to page 1", async () => {
    renderPage();
    await screen.findByText("JV-2001");

    // Move off page 1 first, so we can prove the filter click resets it.
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(lastCallUrl()).toContain("page=2"));

    vi.mocked(apiGet).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Contacted" }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const url = lastCallUrl();
    expect(url).toContain("status=Contacted");
    expect(url).toContain("page=1");
  });
});
