// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// WP-TAG-1 / TAG-06 (pr-review F-3): the Settings → Tags manager had NO component coverage —
// rename-commit vs Escape-cancel, recolor, and the confirm-gated delete are all local state
// machines around a mutation, exactly the shape that rots silently. The API layer is mocked;
// the command side is covered live by tests/integration/tags-api.test.ts.
const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate,
  ApiError: class ApiError extends Error {},
}));

import TagsSettingsPage from "@/app/(admin)/settings/tags/page";

// Radix Dialog (the delete confirmation) needs the pointer APIs jsdom lacks.
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

const TAGS = [
  { id: "t1", name: "Probate", color: "teal", leadCount: 14 },
  { id: "t2", name: "Follow-up", color: "blue", leadCount: 0 },
];

beforeEach(() => {
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockResolvedValue({ tags: TAGS });
  apiMutate.mockResolvedValue({ code: "ok" });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TagsSettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The manager renders each tag as a chip inside a rename button until it is being edited. */
const rowFor = async (name: string) => (await screen.findByRole("button", { name: `Rename ${name}` }));

describe("TAG-06: Settings → Tags manager", () => {
  it("lists every tag with its live usage count", async () => {
    wrap();
    expect(await rowFor("Probate")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
  });

  it("TAG-06: clicking a tag opens an inline rename that COMMITS on Enter", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await rowFor("Probate"));

    const input = screen.getByRole("textbox", { name: /rename probate/i });
    await user.clear(input);
    await user.type(input, "Probate lead{Enter}");

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/tags/t1", "PATCH", { name: "Probate lead" }),
    );
  });

  it("TAG-06: Escape cancels the rename WITHOUT a request (the draft is discarded)", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await rowFor("Probate"));

    const input = screen.getByRole("textbox", { name: /rename probate/i });
    await user.clear(input);
    await user.type(input, "Never saved{Escape}");

    expect(apiMutate).not.toHaveBeenCalled();
    // …and the row is back to its chip, still showing the server's name.
    expect(await rowFor("Probate")).toBeInTheDocument();
  });

  it("an unchanged rename closes the editor without a pointless PATCH", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await rowFor("Probate"));
    await user.keyboard("{Enter}"); // committed as-is
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("TAG-06: a palette swatch recolors the tag; the CURRENT color is pressed and inert", async () => {
    const user = userEvent.setup();
    wrap();
    const group = await screen.findByRole("group", { name: "Color for Probate" });

    // PRN-14: each swatch is named by its palette key, so the choice is never colour-only.
    expect(within(group).getByRole("button", { name: "teal" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "plum" }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/tags/t1", "PATCH", { color: "plum" }));

    // Re-clicking the colour it already has is a no-op, not a redundant write.
    apiMutate.mockClear();
    await user.click(within(group).getByRole("button", { name: "teal" }));
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("TAG-06: delete is CONFIRM-gated and the dialog states the blast radius", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: "Delete Probate" }));

    // Nothing has been sent yet — the confirmation is the gate.
    expect(apiMutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/removes the tag from 14 leads/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /delete tag/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/tags/t1", "DELETE"));
  });

  it("TAG-06: cancelling the confirmation deletes nothing", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: "Delete Follow-up" }));
    const dialog = await screen.findByRole("dialog");
    // The zero-usage wording is the honest one — not "removes it from 0 leads".
    expect(within(dialog).getByText(/isn't on any leads/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("creating a tag posts the trimmed name and lets the server pick the colour (Auto default)", async () => {
    const user = userEvent.setup();
    apiMutate.mockResolvedValue({ id: "t3" });
    wrap();
    await user.type(await screen.findByRole("textbox", { name: /new tag name/i }), "  Cash buyer ask  ");
    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/tags", "POST", { name: "Cash buyer ask" }));
  });

  it("WP-UX-7: picking a colour on the create row passes it through to the POST", async () => {
    const user = userEvent.setup();
    apiMutate.mockResolvedValue({ id: "t3" });
    wrap();
    await user.type(await screen.findByRole("textbox", { name: /new tag name/i }), "Vacant");
    // Choose a specific palette swatch in the "New tag colour" group (not the Auto default).
    const picker = screen.getByRole("group", { name: /new tag colour/i });
    await user.click(within(picker).getByRole("button", { name: "rose" }));
    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/tags", "POST", { name: "Vacant", color: "rose" }));
  });
});
