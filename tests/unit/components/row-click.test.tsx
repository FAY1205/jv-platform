// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// N3C-02/Q5 — whole-row click on the two dense admin tables. The row is a POINTER
// convenience layered over controls that already exist: the RowOpenButton / partner-name
// Link stay the keyboard path, inner controls keep their own behaviour instead of firing
// alongside the row's, and a click that ends a text selection opens nothing. All three are
// pinned here, on the REAL pages, because the guard is one shared helper and a regression in
// it would be invisible in a unit test of the helper alone.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub(props: { refId?: string; onClose?: () => void }) {
      if (!props.refId) return null;
      return <div data-testid="lead-dialog">{props.refId}</div>;
    },
}));

const REF = "LD-26-70001";
const lead = {
  refId: REF,
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
};

const partner = {
  id: "p1",
  refId: "PR-001",
  name: "Lone Star Buyers",
  email: "lone.star@example.com",
  phone: null,
  color: "amber",
  dealTerms: null,
  adminNotes: null,
  status: "active",
  isHouse: false,
  zipCount: 0,
  stateCount: 2,
};

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet, ApiError: class ApiError extends Error {} }));

// jsdom has no pointer-capture APIs; Radix menus need them. (ResizeObserver is stubbed
// globally in tests/setup.ts — N3C-11 put one there for every suite.)
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

import { LeadsView } from "@/app/(admin)/leads/leads-view";
import { PartnersView } from "@/app/(admin)/partners/partners-view";

beforeEach(() => {
  push.mockClear();
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.includes("/api/admin/partners")) return { partners: [partner] };
    if (url.includes("/api/coverage")) return { states: [], counties: [], partners: [], coveredCount: 0 };
    if (url.includes("/api/leads/sources")) return { sources: [] };
    if (url.includes("/api/leads/counts")) return { total: 0, active: 0, unmatched: 0 };
    if (url.includes("/api/tags")) return { tags: [], total: 0, limit: 50 };
    if (url.startsWith("/api/leads?")) return { leads: [lead], page: 1, pageSize: 25, total: 1 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
  window.getSelection()?.removeAllRanges();
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

/** The seller cell — plain text, no interactive ancestor: the row's own surface. */
const leadRowSurface = () => screen.findByText("Marcus Whitfield");

describe("N3C-02/Q5: whole-row click — leads table", () => {
  it("N3C-02/Q5: row click opens the lead; click on inner control does not double-fire", async () => {
    const user = userEvent.setup();
    wrap(<LeadsView initialQ="" />);

    // A click on the row's own surface opens the lead dialog.
    await user.click(await leadRowSurface());
    expect(await screen.findByTestId("lead-dialog")).toHaveTextContent(REF);
  });

  it("N3C-02/Q5: a click on an inner link runs the link, not the row", async () => {
    const user = userEvent.setup();
    wrap(<LeadsView initialQ="" />);
    const row = (await leadRowSurface()).closest("tr")!;

    // The property cell is a real <a> (Google search, opens in a new tab). If the row
    // handler fired on top of it, the admin would get a dialog they never asked for behind
    // the tab they did.
    const link = within(row).getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    await user.click(link);
    expect(screen.queryByTestId("lead-dialog")).toBeNull();
  });

  it("N3C-02/Q5: a click on an inner button runs the button, not the row", async () => {
    const user = userEvent.setup();
    wrap(<LeadsView initialQ="" />);
    const row = (await leadRowSurface()).closest("tr")!;

    // Every button in the row except the RowOpenButton (whose JOB is to open the lead).
    const others = within(row)
      .getAllByRole("button")
      .filter((b) => !b.textContent?.includes(REF));
    expect(others.length).toBeGreaterThan(0);
    for (const b of others) {
      await user.click(b);
      expect(screen.queryByTestId("lead-dialog"), b.textContent ?? b.getAttribute("aria-label") ?? "button").toBeNull();
      await user.keyboard("{Escape}");
    }
  });

  it("N3C-02/Q5: a row click that ends a text selection does not open the row", async () => {
    wrap(<LeadsView initialQ="" />);
    const surface = await leadRowSurface();

    // What a user dragging across the seller's name to copy it leaves behind: the click that
    // RELEASES the drag lands inside the row, with the selection still standing, and must not
    // open a dialog over it. fireEvent, not userEvent, precisely because userEvent models a
    // FRESH press and collapses the document selection on mousedown — which is the one thing
    // this case is not.
    const range = document.createRange();
    range.selectNodeContents(surface);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).not.toBe("");

    fireEvent.click(surface);
    expect(screen.queryByTestId("lead-dialog")).toBeNull();

    // With the selection released, the SAME click opens it — proving the guard, not a broken
    // handler, is what suppressed it.
    selection.removeAllRanges();
    fireEvent.click(surface);
    expect(await screen.findByTestId("lead-dialog")).toHaveTextContent(REF);
  });

  it("N3C-02/Q5: the keyboard path is unchanged — RowOpenButton is still a real button, the row is not a tab stop", async () => {
    wrap(<LeadsView initialQ="" />);
    const row = (await leadRowSurface()).closest("tr")!;
    expect(within(row).getByRole("button", { name: new RegExp(REF) })).toBeInTheDocument();
    // No row-level tab stop or role: it would duplicate every inner control in the tab order.
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).not.toHaveAttribute("role");
    // cursor-pointer only where the whole row actually responds.
    expect(row.className).toContain("cursor-pointer");
  });
});

describe("N3C-02/Q5: whole-row click — partners roster", () => {
  const partnerRow = async () => (await screen.findByText("lone.star@example.com")).closest("tr")!;

  it("N3C-02/Q5: a roster row click opens the partner profile", async () => {
    const user = userEvent.setup();
    wrap(<PartnersView />);
    await user.click(await screen.findByText("lone.star@example.com"));
    expect(push).toHaveBeenCalledWith("/partners/p1");
  });

  it("N3C-02/Q5: the partner-name link stays the keyboard path and the row does not navigate on top of it", async () => {
    const user = userEvent.setup();
    wrap(<PartnersView />);
    const row = await partnerRow();
    const link = within(row).getByRole("link");
    expect(link).toHaveAttribute("href", "/partners/p1");
    await user.click(link);
    // The <a> navigates; the row handler defers to it rather than pushing a second time.
    expect(push).not.toHaveBeenCalled();
  });

  it("N3C-02/Q5: the row-actions menu opens without navigating away", async () => {
    const user = userEvent.setup();
    wrap(<PartnersView />);
    const row = await partnerRow();
    await user.click(within(row).getByRole("button"));
    expect(push).not.toHaveBeenCalled();
    // The menu it opened is the point — a row navigation would have discarded it.
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
  });

  it("N3C-02/Q5: roster rows carry the clickable-row affordance", async () => {
    wrap(<PartnersView />);
    expect((await partnerRow()).className).toContain("cursor-pointer");
  });
});
