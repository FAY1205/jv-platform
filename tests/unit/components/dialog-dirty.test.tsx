// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "@/components/Dialog";

function renderDialog(props: { confirmClose?: boolean; onClose: () => void }) {
  return render(
    <Dialog open onClose={props.onClose} confirmClose={props.confirmClose} title="Edit partner">
      <input aria-label="Name" defaultValue="Josh" />
    </Dialog>,
  );
}

// FRM-02a (audit F-6): a Dialog hosting a form with unsaved changes intercepts an
// Esc/backdrop/✕ dismissal with a lightweight discard-confirmation.
describe("FRM-02a: Dialog discard guard", () => {
  it("DLG-DIRTY-01: without confirmClose, the ✕ closes immediately", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
  });

  it("DLG-DIRTY-02: with confirmClose, the ✕ shows a discard prompt instead of closing", () => {
    const onClose = vi.fn();
    renderDialog({ confirmClose: true, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard unsaved changes/i)).toBeTruthy();
  });

  it("DLG-DIRTY-03: 'Keep editing' dismisses the prompt without closing — the form is still mounted", () => {
    const onClose = vi.fn();
    renderDialog({ confirmClose: true, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Josh");
  });

  it("DLG-DIRTY-04: 'Discard' closes the dialog", () => {
    const onClose = vi.fn();
    renderDialog({ confirmClose: true, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("DLG-DIRTY-05: reopening the dialog clears a stale discard prompt", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} confirmClose title="Edit partner">
        <input aria-label="Name" defaultValue="Josh" />
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeTruthy();
    // Close (open=false) then reopen (open=true): the prompt must not persist.
    rerender(
      <Dialog open={false} onClose={onClose} confirmClose title="Edit partner">
        <input aria-label="Name" defaultValue="Josh" />
      </Dialog>,
    );
    rerender(
      <Dialog open onClose={onClose} confirmClose title="Edit partner">
        <input aria-label="Name" defaultValue="Josh" />
      </Dialog>,
    );
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
  });
});
