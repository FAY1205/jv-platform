// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// N3C-01/Q3 — the leads header's dual count. At the DEFAULT filter state the list is the
// workspace's ACTIVE leads (Removed MLS filtered out), which is why it can read lower than
// the workspace total the sidebar badge is derived from. Naming both numbers is what makes
// that self-explanatory. With any filter applied the header goes back to "N leads match the
// filters" — "active" would be a claim about a set the filters have already redefined.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Stub() {
      return null;
    },
}));

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet, ApiError: class ApiError extends Error {} }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

import { LeadsView } from "@/app/(admin)/leads/leads-view";

const row = (refId: string) => ({
  refId,
  seller: "Marcus Whitfield",
  address: "18 Palo Verde Rd",
  city: "Phoenix",
  state: "AZ",
  zip: "85004",
  campaign: "Weekly",
  mlsStatus: "kept" as const,
  status: "New",
  scoreTotal: null,
  scoreGroup: null,
  partner: null,
  receivedAt: "2026-08-01T00:00:00.000Z",
  modifiedAt: null,
  tags: [],
});

/** The list's own total — the ACTIVE count by construction (the default filters produced it). */
let listTotal = 389;
/** What /api/leads/counts reports for the whole workspace. */
let workspaceCounts: Record<string, number> | null = { total: 412, active: 389, unmatched: 3 };
const requested: string[] = [];

beforeEach(() => {
  listTotal = 389;
  workspaceCounts = { total: 412, active: 389, unmatched: 3 };
  requested.length = 0;
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    requested.push(url);
    if (url.includes("/api/admin/partners")) return { partners: [] };
    if (url.includes("/api/leads/sources")) return { sources: [] };
    if (url.includes("/api/leads/counts")) {
      if (!workspaceCounts) throw new Error("counts unavailable");
      return workspaceCounts;
    }
    if (url.includes("/api/tags")) return { tags: [], total: 0, limit: 50 };
    if (url.startsWith("/api/leads?")) return { leads: [row("LD-26-70001")], page: 1, pageSize: 25, total: listTotal };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
});

function renderLeads(props: { initialQ?: string; initialHot?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadsView initialQ={props.initialQ ?? ""} initialHot={props.initialHot ?? false} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The header line itself (the aria-live count paragraph), not the number span inside it. */
const headerText = async (match: RegExp) => (await screen.findByText(match)).closest("p")!.textContent!.replace(/\s+/g, " ");

describe("N3C-01/Q3: dual lead counts in the leads header", () => {
  it("N3C-01/Q3: the unfiltered header reads 'N active leads · M total'", async () => {
    renderLeads();
    expect(await headerText(/active leads/)).toContain("389 active leads · 412 total");
  });

  it("N3C-01/Q3: singular reads 'active lead'", async () => {
    listTotal = 1;
    workspaceCounts = { total: 5, active: 1, unmatched: 0 };
    renderLeads();
    expect(await headerText(/active lead/)).toContain("1 active lead · 5 total");
  });

  it("N3C-01/Q3: a filtered list keeps the existing 'match the filters' copy", async () => {
    // Any non-default filter redefines the set — "active" would no longer describe it.
    renderLeads({ initialHot: true });
    expect(await headerText(/match the filters/)).toContain("389 leads match the filters");
    expect(screen.queryByText(/active leads/)).toBeNull();
  });

  it("N3C-01/Q3: the workspace total comes from the SHARED counts cache — one request, no second endpoint", async () => {
    renderLeads();
    await screen.findByText(/active leads/);
    // The shell and the header read the same ["leads","counts"] entry (lib/lead-counts):
    // TanStack de-duplicates them into a single in-flight fetch.
    expect(requested.filter((u) => u.includes("/api/leads/counts"))).toHaveLength(1);
  });

  it("N3C-01/Q3: the total is omitted, not faked, while the counts cache is unavailable", async () => {
    workspaceCounts = null; // the endpoint fails
    const { container } = renderLeads();
    // The list's own count still renders; the second half simply isn't claimed.
    await screen.findByText("Marcus Whitfield"); // the list has settled
    const text = container.querySelector('p[aria-live="polite"]')!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("389 leads");
    expect(text).not.toContain("total");
    expect(text).not.toContain("active");
  });
});
