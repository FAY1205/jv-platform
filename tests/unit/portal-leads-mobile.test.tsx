// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-UX-5 (audit portal-mobile 1–3): the phone Leads view no longer loses capability —
// the desktop's debounced search + status filter travel with it (same params), and the
// card leads with the SELLER (info design: the person a partner is about to call).

const calls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    calls.push(url);
    return {
      leads: [
        {
          refId: "LD-26-00929", sellerFirst: "Robert", sellerLast: "Thompson",
          address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
          receivedAt: "2026-08-13T10:00:00Z", status: "New", scoreTotal: null, scoreGroup: null,
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    };
  }),
}));

import { LeadsMobile } from "@/app/portal/leads/leads-mobile";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  calls.length = 0;
});

describe("Portal mobile leads (WP-UX-5)", () => {
  it("UX5-02: the card leads with the seller's name; ref, address and date still present", async () => {
    wrap(<LeadsMobile onOpen={() => {}} />);
    expect(await screen.findByText("Robert Thompson")).toBeInTheDocument();
    expect(screen.getByText("LD-26-00929")).toBeInTheDocument();
    expect(screen.getByText("8193 Maple St")).toBeInTheDocument();
  });

  it("UX5-03: search is debounced onto ?q= — the desktop capability, phone-shaped", async () => {
    wrap(<LeadsMobile onOpen={() => {}} />);
    await screen.findByText("Robert Thompson");
    fireEvent.change(screen.getByRole("textbox", { name: /search your leads/i }), { target: { value: "Ruiz" } });
    await waitFor(() => expect(calls.some((u) => u.includes("q=Ruiz"))).toBe(true));
    // The filter change resets to page 1.
    expect(calls[calls.length - 1]).toContain("page=1");
  });

  it("UX5-04: status chips travel as ?status= and reset the page", async () => {
    wrap(<LeadsMobile onOpen={() => {}} />);
    await screen.findByText("Robert Thompson");
    fireEvent.click(screen.getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(calls.some((u) => u.includes("status=Contacted"))).toBe(true));
    expect(calls[calls.length - 1]).toContain("page=1");
  });
});

// C-41a: the view gate renders this list during the hydration window (it is the markup the
// server sent) but holds its query until the viewport is known — otherwise every DESKTOP
// first paint paid for a page of mobile leads it was about to discard.
describe("C-41a: LeadsMobile fetches only for a resolved mobile viewport", () => {
  it("C-41a: mobile view does not fetch before the viewport resolves", async () => {
    wrap(<LeadsMobile onOpen={() => {}} enabled={false} />);
    // The chrome renders — it is the skeleton state, not a blank screen.
    expect(await screen.findByRole("textbox", { name: /search your leads/i })).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("C-41a: once enabled it asks the ONE canonical url the desktop table and dashboard use", async () => {
    wrap(<LeadsMobile onOpen={() => {}} />);
    await screen.findByText("Robert Thompson");
    expect(calls).toEqual(["/api/portal/leads?page=1&pageSize=20&sort=received&dir=desc"]);
  });
});
