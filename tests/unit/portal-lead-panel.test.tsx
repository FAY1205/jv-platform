// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portalLeadsKey, portalLeadsParams } from "@/modules/portal/leads-contract";

// N5-20/N5-30: the PORTAL lead record inside the side panel — the shell swap (read-scoped:
// the same content as before, no inline editing and no pager), the in-place record switch the
// non-modal panel makes possible, the full-screen sheet below 768px, and the `?open=`
// deep-link behavior, which this route has always handled as a first-mount seed.

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

// The fixtures live INSIDE the factory: vi.mock is hoisted above every top-level binding.
vi.mock("@/lib/api", () => {
  const lead = (refId: string, first: string, last: string) => ({
    refId,
    seller: { first, last, phone: "(859) 938-9128", email: "ana@example.test" },
    address: "20 Bluffside Dr", city: "Covington", state: "KY", zip: "41017",
    reasonForSelling: "Relocation / moving", timeToSell: "Within 1-3 months",
    notes: "Some source notes", receivedAt: "2026-08-04T15:33:00.000Z", status: "Contacted",
    activity: [{ kind: "imported", at: "2026-08-04T15:33:00.000Z", label: "Lead received", actor: null }],
    availableStatuses: ["New", "Contacted", "Closed"],
    listing: { status: "no", link: null },
  });
  const leadsPage = {
    leads: [
      { refId: "JV-2001", sellerFirst: "Ana", sellerLast: "Ruiz", address: "20 Bluffside Dr", city: "Covington", state: "KY", zip: "41017", receivedAt: "2026-08-04T15:33:00.000Z", status: "Contacted", scoreTotal: null, scoreGroup: null },
      { refId: "JV-2002", sellerFirst: "Bo", sellerLast: "Kim", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-08-03T00:00:00.000Z", status: "New", scoreTotal: null, scoreGroup: null },
    ],
    page: 1, pageSize: 20, total: 2,
  };
  // C-11: TasksPanel reads /api/me. A partner holds NO capability — the portal passes canWrite.
  const me = { email: "px@partner.test", role: "partner", capabilities: [], workspace: { name: "PX" }, isPlatformOwner: false };
  return {
    apiGet: vi.fn(async (url: string) => {
      if (url.includes("/api/me")) return me;
      if (url.includes("/notes")) return { notes: [] };
      if (url.includes("/tasks")) return { tasks: [] };
      // The list endpoint carries a query string; a detail read ends in the ref.
      const detail = /\/api\/portal\/leads\/([A-Z0-9-]+)$/.exec(url);
      if (detail) return detail[1] === "JV-2002" ? lead("JV-2002", "Bo", "Kim") : lead(detail[1], "Ana", "Ruiz");
      return leadsPage;
    }),
  };
});

import { ToastProvider } from "@/components";
import { PortalLeadDialog } from "@/app/portal/leads/portal-lead-dialog";
import { PortalLeadsView } from "@/app/portal/leads/portal-leads-view";

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
}

/** The panel plus a page behind it — the thing a non-modal shell must leave alone. */
function Harness({ refId, onClose = () => {} }: { refId: string; onClose?: () => void }) {
  return (
    <>
      <button type="button">Behind the panel</button>
      <PortalLeadDialog refId={refId} onClose={onClose} />
    </>
  );
}

describe("N5-20: the portal lead record in the side panel", () => {
  it("N5-20: the record is a dialog labelled by its ref, with no scrim behind it", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    expect(await screen.findByRole("dialog", { name: /JV-2001/ })).toBeInTheDocument();
    // A scrim is exactly what the non-modal panel must not have (Dialog's overlay class).
    expect(document.querySelector(".anim-scrim")).toBeNull();
  });

  it("N5-20: every section of today's portal record survives the shell swap", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    // Contact + the tap-to-call/mail links.
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(859) 938-9128" })).toHaveAttribute("href", "tel:8599389128");
    expect(screen.getByRole("link", { name: "ana@example.test" })).toHaveAttribute("href", "mailto:ana@example.test");
    // The property Google link (Q4: it stays, admin AND portal).
    expect(screen.getByRole("link", { name: /20 Bluffside Dr/ })).toHaveAttribute("href", expect.stringContaining("google.com/search"));
    // Details grid + the listing badge + source notes.
    expect(screen.getByText("Relocation / moving")).toBeInTheDocument();
    expect(screen.getByText("Within 1-3 months")).toBeInTheDocument();
    expect(screen.getByText("Listing check")).toBeInTheDocument();
    expect(screen.getByText("Some source notes")).toBeInTheDocument();
    // The status control, the tasks panel, the timeline and the partner's own notes.
    expect(screen.getByRole("combobox", { name: /status for JV-2001/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your notes" })).toBeInTheDocument();
  });

  it("N5-20: read-scoped — no inline editing and no N-of-M pager come with the shell", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    await screen.findByText("Ana Ruiz");
    // PR B's editing affordances are admin-only: the seller name is text, not a field.
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /seller/i })).toBeNull();
    // N5-20: the portal list is its own working set — a pager there is a candidate, not this WP.
    expect(screen.queryByRole("group", { name: /navigation/i })).toBeNull();
  });

  it("N5-30: the page behind stays interactive, and focus moves in and returns to the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Openable() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open lead</button>
          {open && <PortalLeadDialog refId="JV-2001" onClose={() => { setOpen(false); onClose(); }} />}
        </>
      );
    }
    render(wrap(<Openable />));
    const opener = screen.getByRole("button", { name: "Open lead" });
    await user.click(opener);

    const panel = await screen.findByRole("dialog", { name: /JV-2001/ });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    // Non-modal: the opener is still in the a11y tree beside the panel.
    expect(screen.getByRole("button", { name: "Open lead" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("N5-30: Esc closes the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(wrap(<Harness refId="JV-2001" onClose={onClose} />));
    await screen.findByText("Ana Ruiz");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("N5-20: switching records in place", () => {
  it("N5-20/A11Y-03: a new ref re-keys the panel without unmounting it, and announces the switch", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (ref: string) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PortalLeadDialog refId={ref} onClose={() => {}} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("JV-2001"));
    await screen.findByText("Ana Ruiz");
    const panel = screen.getByRole("dialog");
    // The panel's OWN live region — a direct child of the dialog, so it is not confused with
    // the `role="status"` an inner empty state renders.
    const region = panel.querySelector(':scope > [role="status"]')!;
    // The region is mounted EMPTY: on a first open the dialog title already names the lead.
    expect(region).toHaveTextContent("");

    // What a row click behind the non-modal panel looks like to this component.
    rerender(ui("JV-2002"));
    // Same panel element — no close/reopen flicker…
    expect(screen.getByRole("dialog")).toBe(panel);
    // …the SAME live region carries the new text (never a freshly mounted one)…
    expect(panel.querySelector(':scope > [role="status"]')).toBe(region);
    expect(region).toHaveTextContent("Now showing lead JV-2002");
    // …and the record on screen is the new one.
    expect(await screen.findByText("Bo Kim")).toBeInTheDocument();
  });

  it("N5-20: a note typed against one lead does not follow the panel to the next", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The list cache is what makes this the REAL row-click path: C-41b's placeholder resolves
    // from it, so the new record paints with no pending gap — nothing unmounts on its own, and
    // the composer below survives the switch unless the record body is keyed on the ref.
    qc.setQueryData(portalLeadsKey(portalLeadsParams()), {
      leads: [
        { refId: "JV-2001", sellerFirst: "Ana", sellerLast: "Ruiz", address: "20 Bluffside Dr", city: "Covington", state: "KY", zip: "41017", receivedAt: "2026-08-04T15:33:00.000Z", status: "Contacted", scoreTotal: null, scoreGroup: null },
        { refId: "JV-2002", sellerFirst: "Bo", sellerLast: "Kim", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-08-03T00:00:00.000Z", status: "New", scoreTotal: null, scoreGroup: null },
      ],
      page: 1, pageSize: 20, total: 2,
    });
    const ui = (ref: string) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PortalLeadDialog refId={ref} onClose={() => {}} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("JV-2001"));
    const box = await screen.findByPlaceholderText(/note/i);
    await user.type(box, "Called, left voicemail");
    expect(box).toHaveValue("Called, left voicemail");

    rerender(ui("JV-2002"));
    await screen.findByText("Bo Kim");
    expect(await screen.findByPlaceholderText(/note/i)).toHaveValue("");
  });
});

describe("N5-20: below 768px the record is a full-screen sheet", () => {
  /** Replaces the setup-file default (a 1280px desktop) for one test. */
  function stubViewport(width: number) {
    const prior = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => {
        const min = /\(min-width:\s*([\d.]+)px\)/.exec(query);
        const max = /\(max-width:\s*([\d.]+)px\)/.exec(query);
        return {
          matches: min ? width >= Number(min[1]) : max ? width <= Number(max[1]) : false,
          media: query, onchange: null,
          addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          dispatchEvent: () => false,
        };
      },
    });
    return () => Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: prior });
  }

  it("N5-20/N5-30: at 375px the sheet is MODAL — the covered page leaves the a11y tree", async () => {
    const restore = stubViewport(375);
    try {
      render(wrap(<Harness refId="JV-2001" />));
      expect(await screen.findByRole("dialog", { name: /JV-2001/ })).toBeInTheDocument();
      // A phone screen the sheet covers completely must not stay reachable behind it.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Behind the panel" })).toBeNull());
      // …and the way out is still one reachable control.
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("N5-20: at 1280px the same panel leaves the page behind it in the a11y tree", async () => {
    const restore = stubViewport(1280);
    try {
      render(wrap(<Harness refId="JV-2001" />));
      await screen.findByRole("dialog", { name: /JV-2001/ });
      expect(screen.getByRole("button", { name: "Behind the panel" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe("N5-20: the ?open= deep link is unchanged", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/portal/leads");
  });

  it("N5-20: ?open=<ref> lands straight in the panel", async () => {
    render(wrap(<PortalLeadsView initialOpenRef="JV-2001" />));
    expect(await screen.findByRole("dialog", { name: /JV-2001/ })).toBeInTheDocument();
  });

  it("N5-20: closing drops the panel and leaves the URL alone (this route never rewrote it)", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/portal/leads?open=JV-2001");
    render(wrap(<PortalLeadsView initialOpenRef="JV-2001" />));
    await screen.findByRole("dialog", { name: /JV-2001/ });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The list is still there behind it, and the address bar is untouched.
    expect(await screen.findByText("JV-2002")).toBeInTheDocument();
    expect(window.location.search).toBe("?open=JV-2001");
  });

  it("N5-20: a row click while the panel is open SWITCHES the record instead of closing it", async () => {
    const user = userEvent.setup();
    render(wrap(<PortalLeadsView initialOpenRef="JV-2001" />));
    const panel = await screen.findByRole("dialog", { name: /JV-2001/ });
    // The open row says so — the panel beside it is not the only signal (PRN-14).
    await waitFor(() => expect(document.querySelector('tr[aria-current="true"]')).not.toBeNull());

    // The row's keyboard/AT open affordance for the OTHER lead, behind the non-modal panel.
    await user.click(screen.getByRole("button", { name: /JV-2002/ }));

    expect(screen.getByRole("dialog")).toBe(panel);
    expect(await screen.findByRole("dialog", { name: /JV-2002/ })).toBeInTheDocument();
  });
});
