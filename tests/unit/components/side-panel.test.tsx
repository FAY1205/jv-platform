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
}: {
  confirmClose?: boolean;
  onOutside?: () => void;
  onClosed?: () => void;
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
        title="LD-26-00001"
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
});
