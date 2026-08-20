// @vitest-environment jsdom
import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// N5-02/N5-03/N5-04: the admin lead record inside the side panel — the ported ViewMode
// content, the header pager slot, and the ↑/↓ binding (which lives on the panel because only
// the panel knows whether an edit form is open).

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

const DETAIL = {
  refId: "LD-26-00929",
  seller: { first: "Robert", last: "Thompson", phone: "(859) 938-9128", email: "rt@example.test" },
  address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
  campaign: "Direct mail", notes: "", reasonForSelling: "Relocation / moving", motivation: "",
  timeToSell: "Within 1-3 months", mlsStatus: "kept" as const, mlsReason: "", status: "New",
  score: { total: 41, group: "hot" as const, status: "complete" as const, breakdown: null },
  editable: true, receivedAt: "2026-08-13T10:00:00.000Z", modifiedAt: null,
  partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
  assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: "75045", original: null },
  availableStatuses: ["New", "Contacted"],
  activity: [],
};

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes("/api/me")) {
      return { email: "a@example.test", role: "admin", capabilities: ["leads.read", "leads.write", "work.write", "views.own"], workspace: { name: "W" }, isPlatformOwner: false };
    }
    if (url.includes("/notes")) return { notes: [] };
    if (url.includes("/tasks")) return { tasks: [] };
    if (url.includes("/partners")) return { partners: [] };
    return DETAIL;
  }),
}));

import { ToastProvider } from "@/components";
import { LeadDialog } from "@/app/(admin)/leads/lead-dialog";
import type { LeadNav } from "@/app/(admin)/leads/lead-pager";

function navStub(over: Partial<LeadNav> = {}): LeadNav {
  return { index: 3, total: 686, canPrev: true, canNext: true, pending: false, prev: vi.fn(), next: vi.fn(), ...over };
}

function renderPanel({ nav = navStub(), onClose = () => {} }: { nav?: LeadNav | null; onClose?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadDialog refId="LD-26-00929" onClose={onClose} nav={nav} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return nav;
}

describe("N5-02/N5-03: the lead record in the side panel", () => {
  it("N5-02: the record is a dialog labelled by its ref, with no scrim behind it", async () => {
    renderPanel();
    expect(await screen.findByRole("dialog", { name: /LD-26-00929/ })).toBeInTheDocument();
    expect(document.querySelector(".anim-scrim")).toBeNull();
  });

  it("N5-03: the ViewMode content ports intact — fields, score, the Google property link", async () => {
    renderPanel();
    expect(await screen.findByText("Robert Thompson")).toBeInTheDocument();
    expect(screen.getByText("(859) 938-9128")).toBeInTheDocument();
    expect(screen.getByText("Relocation / moving")).toBeInTheDocument();
    expect(screen.getByText("Lead score")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /8193 Maple St/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("google.com/search"));
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("N5-04: the pager renders in the panel header when the lead is in the working set", async () => {
    renderPanel();
    expect(await screen.findByRole("group", { name: "Lead navigation" })).toHaveTextContent("3 of 686");
  });

  it("N5-05: no nav means no pager — a deep link outside the filters gets no lying position", async () => {
    renderPanel({ nav: null });
    await screen.findByText("Robert Thompson");
    expect(screen.queryByRole("group", { name: "Lead navigation" })).toBeNull();
  });
});

describe("N5-04: ↑/↓ move between leads", () => {
  it("N5-04: ↑/↓ step to the previous/next lead", async () => {
    const user = userEvent.setup();
    const nav = renderPanel()!;
    await screen.findByText("Robert Thompson");

    await user.keyboard("{ArrowDown}");
    expect(nav.next).toHaveBeenCalledOnce();
    await user.keyboard("{ArrowUp}");
    expect(nav.prev).toHaveBeenCalledOnce();
  });

  it("N5-04: an end of the list does not fire — the arrow is a real boundary", async () => {
    const user = userEvent.setup();
    const nav = renderPanel({ nav: navStub({ canNext: false }) })!;
    await screen.findByText("Robert Thompson");
    await user.keyboard("{ArrowDown}");
    expect(nav.next).not.toHaveBeenCalled();
  });

  it("N5-04: a page jump in flight does not fire again", async () => {
    const user = userEvent.setup();
    const nav = renderPanel({ nav: navStub({ pending: true }) })!;
    await screen.findByText("Robert Thompson");
    await user.keyboard("{ArrowDown}");
    expect(nav.next).not.toHaveBeenCalled();
  });

  it("N5-04: arrows never fire while focus is in a text control", async () => {
    const user = userEvent.setup();
    const nav = renderPanel()!;
    // The admin-notes composer is a textarea inside the panel.
    const box = await screen.findByPlaceholderText(/note/i);
    await user.click(box);
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(nav.next).not.toHaveBeenCalled();
    expect(nav.prev).not.toHaveBeenCalled();
  });

  it("N5-04: arrows are off entirely while the edit form is open", async () => {
    const user = userEvent.setup();
    const nav = renderPanel()!;
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByLabelText("Seller first name");

    // Focus something that is not a text control, then press the keys.
    await user.click(screen.getByRole("button", { name: "Cancel" }).parentElement!);
    await user.keyboard("{ArrowDown}{ArrowUp}");
    expect(nav.next).not.toHaveBeenCalled();
    expect(nav.prev).not.toHaveBeenCalled();
  });
});

describe("N5-02: switching records in place", () => {
  it("N5-02: a new ref re-keys the panel without unmounting it, and drops edit mode", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (ref: string) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <LeadDialog refId={ref} onClose={() => {}} nav={navStub()} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("LD-26-00929"));

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByLabelText("Seller first name")).toBeInTheDocument();
    const panel = screen.getByRole("dialog");

    // What a row click behind the open panel looks like to this component.
    rerender(ui("LD-26-00930"));
    // Same panel element — no close/reopen flicker.
    expect(screen.getByRole("dialog")).toBe(panel);
    // …and the previous record's edit form is gone rather than showing over the new lead.
    await waitFor(() => expect(screen.queryByLabelText("Seller first name")).toBeNull());
    expect(screen.getByText("LD-26-00930")).toBeInTheDocument();
  });
});
