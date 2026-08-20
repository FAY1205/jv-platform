// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineField, INLINE_HINT } from "@/components";

// N5-10/N5-11 — the InlineField state machine, isolated from any request: open, pre-select,
// commit on Enter, commit on blur, revert on Esc, the no-op for an unchanged value, the mask,
// the saving/disabled states, and the retry reopen.

/** A host that owns `value` the way the lead record does — commits land, so the tests can
 *  tell a real commit from a repaint. */
function Host({
  initial = "(918) 555-0164",
  onCommit,
  ...rest
}: { initial?: string; onCommit?: (v: string) => void } & Partial<React.ComponentProps<typeof InlineField>>) {
  const [value, setValue] = React.useState(initial);
  return (
    <InlineField
      label="Phone"
      value={value}
      onCommit={(v) => {
        onCommit?.(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

const openField = (name = /Edit/i) => screen.getByRole("button", { name });

describe("N5-10: opening an inline field", () => {
  it("N5-10: rest state is plain text; clicking it opens an input with the value pre-selected", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(openField());
    const input = screen.getByRole("textbox", { name: "Phone" });
    expect(input).toHaveValue("(918) 555-0164");
    // Pre-selected: typing replaces the whole value rather than appending to it.
    await user.keyboard("new");
    expect(input).toHaveValue("new");
  });

  it("N5-30: the field is reachable and openable by keyboard alone", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.tab();
    expect(openField()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveFocus();
  });

  it("N5-10: the first-edit hint is shown only when the host asks for it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host hint />);
    await user.click(openField());
    expect(screen.getByText(INLINE_HINT)).toBeInTheDocument();
    unmount();

    render(<Host hint={false} />);
    await user.click(openField());
    expect(screen.queryByText(INLINE_HINT)).toBeNull();
  });
});

describe("N5-11: commit-on-blur", () => {
  it("N5-11: Enter commits the changed value and closes the field", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Host onCommit={onCommit} />);

    await user.click(openField());
    await user.keyboard("(918) 555-0170{Enter}");

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("(918) 555-0170");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("N5-11: clicking away commits too", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <Host onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(openField());
    await user.keyboard("moved");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("moved");
  });

  it("N5-11: Esc reverts and exits — no commit, and the old value is back on screen", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Host onCommit={onCommit} />);

    await user.click(openField());
    await user.keyboard("typed over{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("(918) 555-0164")).toBeInTheDocument();
  });

  it("N5-11: Esc beats the blur it causes — leaving the field does not resurrect the commit", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <Host onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(openField());
    await user.keyboard("typed over{Escape}");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("N5-11: an unchanged value costs no request — neither Enter nor blur commits", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <Host onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(openField());
    await user.keyboard("{Enter}");
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(openField());
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("N5-10: mask, saving, disabled", () => {
  it("N5-12: the State mask keeps the value to two uppercase letters", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Host label="State" initial="" onCommit={onCommit} mask={(raw) => raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)} />);

    await user.click(openField());
    await user.keyboard("tx9as{Enter}");

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("TX");
  });

  it("N5-10: `saving` paints the optimistic value with a spinner", () => {
    const { container, rerender } = render(<Host initial="(918) 555-0170" saving />);
    // Optimistic: the NEW value is already on screen while the request is in flight.
    expect(screen.getByText("(918) 555-0170")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    rerender(<Host initial="(918) 555-0170" saving={false} />);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("N5-10: a disabled field cannot be opened (C-41b: never seed a draft from a partial record)", async () => {
    const user = userEvent.setup();
    render(<Host disabled />);
    const btn = openField();
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("N5-10: a non-editable field renders as plain text with no control at all", () => {
    render(<Host editable={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("(918) 555-0164")).toBeInTheDocument();
  });

  it("WP-UX-7: an empty value is demoted to 'Not provided', not shown as a dash", () => {
    render(<Host initial="" />);
    expect(screen.getByText("Not provided")).toBeInTheDocument();
  });
});

describe("N5-11: the retry reopen", () => {
  it("N5-11: a new reopen nonce puts the field back into editing with the attempted text", async () => {
    function RetryHost() {
      const [reopen, setReopen] = React.useState<{ text: string; nonce: number } | null>(null);
      return (
        <>
          <InlineField label="Phone" value="(918) 555-0164" onCommit={() => {}} reopen={reopen} />
          <button type="button" onClick={() => setReopen({ text: "attempted", nonce: 1 })}>
            Retry
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<RetryHost />);
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("attempted");
  });

  it("N5-11: the SAME text retried twice reopens twice — the nonce, not the text, is the trigger", async () => {
    function RetryHost() {
      const [reopen, setReopen] = React.useState<{ text: string; nonce: number } | null>(null);
      const n = React.useRef(0);
      return (
        <>
          <InlineField label="Phone" value="(918) 555-0164" onCommit={() => {}} reopen={reopen} />
          <button
            type="button"
            onClick={() => {
              n.current += 1;
              setReopen({ text: "attempted", nonce: n.current });
            }}
          >
            Retry
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<RetryHost />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("attempted");
  });
});

describe("N5-15: a landing save cannot clobber an open draft", () => {
  it("N5-15: a new `value` arriving while the field is open leaves the typed draft alone", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InlineField label="Phone" value="old" onCommit={() => {}} />);

    await user.click(openField());
    await user.keyboard("half-typed");

    // What a refetch looks like to this component: the committed value changes underneath it.
    rerender(<InlineField label="Phone" value="server-value" onCommit={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("half-typed");
  });
});

describe("N5-10: the multiline variant (Source notes)", () => {
  it("N5-10: Enter inserts a newline rather than committing; clicking away commits", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <Host label="Source notes" initial="one" multiline onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: /Edit Source notes/i }));
    await user.keyboard("a{Enter}b");
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("a\nb");
  });
});
