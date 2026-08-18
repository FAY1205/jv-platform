// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-PW-3 Task 2: the desktop (>= lg) sortable/filterable/paginated partner Leads table.
// `useIsDesktop` is mocked true so the page gate mounts LeadsDesktop (not the mobile card
// list) — proves the wiring in page.tsx, not just the child component in isolation.

const LEADS_PAGE = {
  leads: [
    { refId: "JV-2001", sellerFirst: "Ana", sellerLast: "Ruiz", address: "12 Elm St", city: "Austin", state: "TX", zip: "78701", receivedAt: "2026-07-10T00:00:00.000Z", status: "New" },
    { refId: "JV-2002", sellerFirst: "Bo", sellerLast: "Kim", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-07-09T00:00:00.000Z", status: "Contacted" },
  ],
  page: 1,
  pageSize: 20,
  total: 45, // > one page's worth, so Pagination's "Next page" button is enabled
};

vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => LEADS_PAGE) }));
// C-41a: the gate reads the THREE-state viewport now ("unresolved" through hydration), so
// the mock is a mutable value the tests below drive.
let viewport: "unresolved" | "desktop" | "mobile" = "desktop";
vi.mock("@/lib/use-media-query", () => ({
  useDesktopState: () => viewport,
  useIsDesktop: () => viewport === "desktop",
}));

import { apiGet } from "@/lib/api";
import { ToastProvider } from "@/components";
import { PortalLeadsView } from "@/app/portal/leads/portal-leads-view";

// VP-4: the page is now a server component; render the client gate directly. ToastProvider
// wraps it because the desktop table's inline StatusSelect cells call useToast().
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PortalLeadsView initialOpenRef={null} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function lastCallUrl(): string {
  const calls = vi.mocked(apiGet).mock.calls;
  return calls[calls.length - 1][0] as string;
}

beforeEach(() => {
  viewport = "desktop";
  vi.mocked(apiGet).mockClear();
});

describe("C-41a: one fetch per portal-leads first paint", () => {
  it("C-41a: a desktop first paint issues exactly ONE canonical request", async () => {
    renderPage();
    await screen.findByText("JV-2001");
    // Was two: LeadsMobile mounted and fetched during hydration, then LeadsDesktop fetched
    // its own differently-keyed url. Now the mobile list never fetches for a desktop.
    expect(vi.mocked(apiGet).mock.calls).toHaveLength(1);
    const url = lastCallUrl();
    expect(url).toContain("page=1");
    expect(url).toContain("pageSize=20");
    expect(url).toContain("sort=received");
    expect(url).toContain("dir=desc");
  });

  it("C-41a: the view does not fetch at all before the viewport resolves", async () => {
    viewport = "unresolved";
    renderPage();
    // The mobile markup renders (it is what the server sent) — with its query held.
    await screen.findByRole("textbox", { name: /search your leads/i });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("C-41a: a resolved mobile viewport fetches once, on the SAME canonical url as desktop", async () => {
    viewport = "mobile";
    renderPage();
    await screen.findByText("Ana Ruiz");
    expect(vi.mocked(apiGet).mock.calls).toHaveLength(1);
    expect(lastCallUrl()).toBe("/api/portal/leads?page=1&pageSize=20&sort=received&dir=desc");
  });
});

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

    // WP-UX-1: the standalone City column folded into Address; the Address header
    // now carries the city sort (same sort=city request — asserted below).
    fireEvent.click(screen.getByRole("button", { name: /address/i }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const url = lastCallUrl();
    expect(url).toContain("sort=city");
    expect(url).toContain("dir=asc");
  });

  it("PW3-02: toggling sort direction on the active column flips asc/desc", async () => {
    renderPage();
    await screen.findByText("JV-2001");

    fireEvent.click(screen.getByRole("button", { name: /address/i })); // city sort (WP-UX-1: lives on the Address header), default asc
    await waitFor(() => expect(lastCallUrl()).toContain("sort=city"));
    await screen.findByText("JV-2001"); // wait for the re-fetched table to settle (not the loading skeleton)
    vi.mocked(apiGet).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /address/i })); // same column again -> flips
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
    // WP-UX-6: status is a multi-select menu now — open it (Radix trigger needs a real
    // pointer sequence, so userEvent), then toggle the item.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Status:/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Contacted" }));

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const url = lastCallUrl();
    expect(url).toContain("status=Contacted");
    expect(url).toContain("page=1");
  });
});
