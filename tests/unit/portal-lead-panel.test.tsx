// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  // Distinct phone/email per lead: the panel switches records WITHOUT unmounting, so a shared
  // fixture value could not tell "the new lead's PII" apart from "the old lead's PII, still on
  // screen" (PRN-08). The seller PHONE is the detail-only field a partner is about to dial.
  const lead = (refId: string, first: string, last: string, phone: string, email: string) => ({
    refId,
    seller: { first, last, phone, email },
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
      if (detail) {
        return detail[1] === "JV-2002"
          ? lead("JV-2002", "Bo", "Kim", "(214) 555-0117", "bo@example.test")
          : lead(detail[1], "Ana", "Ruiz", "(859) 938-9128", "ana@example.test");
      }
      return leadsPage;
    }),
  };
});

import { apiGet } from "@/lib/api";
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

/**
 * Replaces the setup-file default (a 1280px desktop) for one test.
 *
 * `set(width)` moves the viewport LIVE and fires every registered `change` listener, which is
 * what a rotation looks like to `useSyncExternalStore` — a stub whose `addEventListener` is a
 * no-op can only ever assert the viewport a component MOUNTED at.
 */
function stubViewport(width: number) {
  const prior = window.matchMedia;
  let current = width;
  const listeners = new Set<() => void>();
  const matches = (query: string) => {
    const min = /\(min-width:\s*([\d.]+)px\)/.exec(query);
    const max = /\(max-width:\s*([\d.]+)px\)/.exec(query);
    return min ? current >= Number(min[1]) : max ? current <= Number(max[1]) : false;
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      // A getter, not a snapshot: `useSyncExternalStore` re-reads the SAME mql after a change.
      get matches() { return matches(query); },
      media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener: (_type: string, cb: () => void) => { listeners.add(cb); },
      removeEventListener: (_type: string, cb: () => void) => { listeners.delete(cb); },
      dispatchEvent: () => false,
    }),
  });
  return {
    set(next: number) {
      current = next;
      for (const cb of [...listeners]) cb();
    },
    restore() {
      Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: prior });
    },
  };
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
    // N5E-07: the seller is First name + Last name, two cells of the span grid.
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Ruiz")).toBeInTheDocument();
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

  it("N5E-07: the portal record wears the admin record's span grid and field order", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    await screen.findByText("Ana");
    const grid = document.querySelector(".grid-cols-6") as HTMLElement;
    expect(grid).not.toBeNull();
    const at = (label: string) => within(grid).getByText(label);
    const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Same order as the admin twin: name/phone → email → address → short values → reason →
    // received → the live control.
    expect(precedes(at("First name"), at("Email"))).toBe(true);
    expect(precedes(at("Email"), at("Address"))).toBe(true);
    expect(precedes(at("Address"), at("Time to sell"))).toBe(true);
    expect(precedes(at("Reason for selling"), at("Received"))).toBe(true);
    // N5E-04: the status control is a labelled field AFTER Received, not a banner above it.
    expect(precedes(at("Received"), at("Lead status"))).toBe(true);
    // N5E-05: the timestamp cannot break across two lines here either.
    expect((at("Received").nextElementSibling as HTMLElement).className).toContain("whitespace-nowrap");
  });

  it("N5E-06: the portal address is the same ONE combined line, display-only", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    // Street, city, then state + ZIP as a single place designator.
    const link = await screen.findByRole("link", { name: /^20 Bluffside Dr, Covington, KY 41017/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("google.com/search"));
    // Read-scoped: the line is a link out, never an edit affordance (PRN-08).
    expect(screen.queryByRole("button", { name: /^Address:/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Street" })).toBeNull();
  });

  it("N5-20: read-scoped — no inline editing and no N-of-M pager come with the shell", async () => {
    render(wrap(<PortalLeadDialog refId="JV-2001" onClose={() => {}} />));
    await screen.findByText("Ana");
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
    await screen.findByText("Ana");
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
    await screen.findByText("Ana");
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

    // PRN-08/N5-21: eviction is IMMEDIATE, asserted before the new detail is awaited. The
    // panel never unmounts, so the previous seller's phone must be gone on the very frame the
    // ref changes — a `keepPreviousData`-style smoothing added later for a nicer transition
    // would leave the OLD seller's number sitting under the NEW lead's title, which on this
    // surface is a partner dialling the wrong person.
    expect(screen.queryByRole("link", { name: "(859) 938-9128" })).toBeNull();

    // …and the record on screen is the new one.
    expect(await screen.findByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("Kim")).toBeInTheDocument();

    // PRN-08/N5-21: the panel never unmounted, so "the new lead is present" is only half the
    // claim — the OLD lead's PII has to be GONE. Asserted on the detail-only field a partner
    // acts on (the phone they are about to dial) as well as the name, because a surface that
    // switches records in place is exactly where one stale contact detail sends a call to the
    // wrong seller.
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.queryByText("Ruiz")).toBeNull();
    expect(screen.queryByText("(859) 938-9128")).toBeNull();
    expect(screen.queryByRole("link", { name: "(859) 938-9128" })).toBeNull();
    expect(screen.getByRole("link", { name: "(214) 555-0117" })).toBeInTheDocument();
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
    await screen.findByText("Bo");
    expect(await screen.findByPlaceholderText(/note/i)).toHaveValue("");
  });
});

describe("N5-20: below 768px the record is a full-screen sheet", () => {
  it("N5-20/N5-30: at 375px the sheet is MODAL — the covered page leaves the a11y tree", async () => {
    const vp = stubViewport(375);
    try {
      render(wrap(<Harness refId="JV-2001" />));
      expect(await screen.findByRole("dialog", { name: /JV-2001/ })).toBeInTheDocument();
      // A phone screen the sheet covers completely must not stay reachable behind it.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Behind the panel" })).toBeNull());
      // …and the way out is still one reachable control.
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    } finally {
      vp.restore();
    }
  });

  it("N5-20: at 1280px the same panel leaves the page behind it in the a11y tree", async () => {
    const vp = stubViewport(1280);
    try {
      render(wrap(<Harness refId="JV-2001" />));
      await screen.findByRole("dialog", { name: /JV-2001/ });
      expect(screen.getByRole("button", { name: "Behind the panel" })).toBeInTheDocument();
    } finally {
      vp.restore();
    }
  });

  it("N5-30: a viewport crossing 768px MID-OPEN neither remounts the panel nor steals focus", async () => {
    // Radix picks DialogContentModal vs DialogContentNonModal off `modal` — two different
    // component TYPES at one JSX position — so letting `modal` change while the panel is open
    // is a remount: new DOM node, focus yanked back to the opener by the outgoing content's
    // close-autofocus, scroll position gone. A phone rotating from 375 to 1024 crosses that
    // boundary with the record open, which is the portal's primary device.
    const vp = stubViewport(375);
    try {
      render(wrap(<Harness refId="JV-2001" />));
      const panel = await screen.findByRole("dialog", { name: /JV-2001/ });
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

      act(() => vp.set(1024));

      // Same element — not a close/reopen…
      expect(screen.getByRole("dialog")).toBe(panel);
      // …and focus is still where the reader left it, inside the panel.
      expect(panel.contains(document.activeElement)).toBe(true);
    } finally {
      vp.restore();
    }
  });
});

describe("N5-20: the mobile card list beside the panel", () => {
  // Every other test in this file runs at the setup file's 1280px default, where the DESKTOP
  // table mounts — so the card list's own open-record marking had no coverage at all.
  it("N5-20/PRN-14: at 900px the open card carries aria-current and its siblings do not", async () => {
    const vp = stubViewport(900);
    try {
      render(wrap(<PortalLeadsView initialOpenRef="JV-2001" />));
      // Matched on the address inside the card (its accessible name), not on the ref — the
      // panel beside it names the same lead, and the point is to pick out the CARD.
      const openCard = await screen.findByRole("button", { name: /20 Bluffside Dr/ });
      const otherCard = screen.getByRole("button", { name: /88 Oak Ave/ });
      expect(openCard).toHaveAttribute("aria-current", "true");
      // Not just "different" — absent. `aria-current="false"` would announce on every card.
      expect(otherCard).not.toHaveAttribute("aria-current");
    } finally {
      vp.restore();
    }
  });

  it("N5-30 (SC 2.4.7): the open card's focus indicator is not its resting border", async () => {
    const vp = stubViewport(900);
    try {
      render(wrap(<PortalLeadsView initialOpenRef="JV-2001" />));
      const openCard = await screen.findByRole("button", { name: /20 Bluffside Dr/ });
      // jsdom applies no stylesheet, so the class list is the assertion surface — and what is
      // being asserted is a RELATIONSHIP, not a look: the open card already rests on
      // `border-brand-ink`, so a border-swap focus style is invisible on precisely the card
      // focus returns to when the sheet closes. The indicator has to be a separate property.
      expect(openCard.className).toContain("border-brand-ink");
      expect(openCard.className).toMatch(/focus-visible:ring-2/);
      expect(openCard.className).toMatch(/focus-visible:ring-brand-ink/);
      expect(openCard.className).not.toMatch(/focus-visible:border-/);
    } finally {
      vp.restore();
    }
  });
});

describe("N5-30: focus on the REAL open paths", () => {
  // The focus tests above open the panel from a synthetic button. These two use the controls a
  // partner actually presses, which is where the opener capture can differ: the desktop path
  // goes through the shared RowOpenButton, the mobile one through the card itself.
  it("N5-30: the desktop row button hands focus to the panel and gets it back on close", async () => {
    const user = userEvent.setup();
    render(wrap(<PortalLeadsView />));
    const rowButton = await screen.findByRole("button", { name: "JV-2001" });
    await user.click(rowButton);

    const panel = await screen.findByRole("dialog", { name: /JV-2001/ });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(rowButton);
  });

  it("N5-30: a mobile card hands focus to the sheet and gets it back on close", async () => {
    const vp = stubViewport(900);
    try {
      const user = userEvent.setup();
      render(wrap(<PortalLeadsView />));
      const card = await screen.findByRole("button", { name: /20 Bluffside Dr/ });
      await user.click(card);

      const panel = await screen.findByRole("dialog", { name: /JV-2001/ });
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // The same card element — the list re-renders when `openRef` clears, so this also pins
      // that the card is reconciled rather than replaced under the returning focus.
      expect(document.activeElement).toBe(card);
    } finally {
      vp.restore();
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

  it("N5-20: a malformed ?open= seed never becomes a request path segment", async () => {
    // `?open=` arrives in a link, so its value is attacker-influenced and it is interpolated
    // into `/api/portal/leads/<ref>`. The mis-targeted route is gated server-side, so this is
    // defence in depth — asserted at the boundary that decides, not at the gate downstream.
    render(wrap(<PortalLeadsView initialOpenRef="../../../api/me" />));
    // The list still renders normally…
    expect(await screen.findByText("JV-2002")).toBeInTheDocument();
    // …the panel simply never opens…
    expect(screen.queryByRole("dialog")).toBeNull();
    // …and nothing traversed out of the leads collection.
    expect(vi.mocked(apiGet).mock.calls.some(([url]) => String(url).includes(".."))).toBe(false);
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
