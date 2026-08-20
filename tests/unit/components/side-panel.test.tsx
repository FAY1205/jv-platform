// @vitest-environment jsdom
import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidePanel } from "@/components/SidePanel";

// N5-01: the non-modal side panel. The whole point of the primitive is what it does NOT do —
// no scrim, no focus trap, no dismiss-on-outside-click — so that is what these prove.

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

/** The page behind the panel, with a button that must stay reachable and clickable. */
function Harness({
  confirmClose = false,
  onOutside = () => {},
  onClosed = () => {},
  resetKey,
  statusMessage,
}: {
  confirmClose?: boolean;
  onOutside?: () => void;
  onClosed?: () => void;
  resetKey?: string;
  statusMessage?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (open) onOutside();
          else setOpen(true);
        }}
      >
        Open lead
      </button>
      <SidePanel
        open={open}
        confirmClose={confirmClose}
        onClose={() => { setOpen(false); onClosed(); }}
        title={resetKey ?? "LD-26-00001"}
        resetKey={resetKey}
        statusMessage={statusMessage}
      >
        <input aria-label="Note" defaultValue="draft" />
      </SidePanel>
    </div>
  );
}

describe("N5-01: SidePanel (non-modal)", () => {
  it("N5-01: renders a dialog labelled by its title, with NO scrim", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));

    expect(screen.getByRole("dialog", { name: "LD-26-00001" })).toBeInTheDocument();
    // A scrim is exactly what a non-modal panel must not have (Dialog's overlay class).
    expect(document.querySelector(".anim-scrim")).toBeNull();
  });

  it("N5-01: the page behind stays interactive — an outside click does NOT close the panel", async () => {
    const user = userEvent.setup();
    const onOutside = vi.fn();
    const onClosed = vi.fn();
    render(<Harness onOutside={onOutside} onClosed={onClosed} />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));

    // The same button, now "outside" the open panel: its handler runs and the panel stays.
    await user.click(screen.getByRole("button", { name: "Open lead" }));
    expect(onOutside).toHaveBeenCalledOnce();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "LD-26-00001" })).toBeInTheDocument();
  });

  it("N5-01: Esc closes the panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("N5-01: the ✕ closes the panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("N5-01/N5-30: focus moves into the panel on open and returns to the opener on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open lead" });
    await user.click(opener);

    const panel = screen.getByRole("dialog", { name: "LD-26-00001" });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("N5-03 (FRM-02a): a dismiss gesture on a dirty form asks before discarding", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness confirmClose onClosed={onClosed} />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("N5-02: a row-click switch while the discard-confirm overlay is showing drops the overlay instead of closing the panel", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    const { rerender } = render(<Harness confirmClose resetKey="LD-26-00001" onClosed={onClosed} />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));

    // Dirty record, dismiss gesture → the guard is up.
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("alertdialog", { name: /discard unsaved changes/i })).toBeInTheDocument();

    // What a row click behind the non-modal panel looks like: same panel, new record.
    rerender(<Harness confirmClose resetKey="LD-26-00002" onClosed={onClosed} />);

    // The prompt belonged to the PREVIOUS record — it must not survive to close this one.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "LD-26-00002" })).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("A11Y-03: the panel's live region is mounted from the start and only its text changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness statusMessage="" />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));

    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    expect(region).toHaveAttribute("aria-live", "polite");

    rerender(<Harness statusMessage="Now showing lead LD-26-00002" />);
    // The SAME node carries the new text — never a freshly mounted region with content in it.
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Now showing lead LD-26-00002");
  });

  it("N5-30: the discard guard contains Tab — the non-modal panel has no outer trap to fall back on", async () => {
    const user = userEvent.setup();
    render(<Harness confirmClose />);
    await user.click(screen.getByRole("button", { name: "Open lead" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    const keep = screen.getByRole("button", { name: /keep editing/i });
    const discard = screen.getByRole("button", { name: /^discard$/i });
    await waitFor(() => expect(document.activeElement).toBe(keep));

    await user.tab();
    expect(document.activeElement).toBe(discard);
    // …and off the last control it wraps back rather than escaping into the covered fields.
    await user.tab();
    expect(document.activeElement).toBe(keep);
  });
});

describe("N5-01: modality follows the 768px sheet breakpoint", () => {
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

  it("N5-01: at ≥768px the panel is NON-modal — the page behind stays in the a11y tree", async () => {
    const user = userEvent.setup();
    const restore = stubViewport(1280);
    try {
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "Open lead" }));
      expect(screen.getByRole("dialog", { name: "LD-26-00001" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Open lead" })).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("N5-01: below 768px the full-bleed sheet IS modal — the covered page leaves the a11y tree", async () => {
    const user = userEvent.setup();
    const restore = stubViewport(375);
    try {
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "Open lead" }));
      expect(screen.getByRole("dialog", { name: "LD-26-00001" })).toBeInTheDocument();
      // A page that is completely obscured must not stay reachable behind the sheet.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Open lead" })).toBeNull());
    } finally {
      restore();
    }
  });
});
