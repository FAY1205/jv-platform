// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import { EMPTY_SAVED_VIEW_FILTERS, type SavedViewFilters } from "@/modules/saved-views/schema";

// WP-SV-1 / SV-05 — the views dropdown's own behaviour. Applying, the "modified" indicator,
// and the two confirm-gated dialogs are local state machines around mutations: exactly the
// shape that rots silently. The API layer is mocked here; the command side is covered live by
// tests/integration/saved-views-api.test.ts, and the apply→refetch round trip by
// tests/unit/components/leads-saved-views.test.tsx.
const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet, apiMutate, ApiError: class ApiError extends Error {} }));

import { SavedViewsMenu } from "@/components/SavedViewsMenu";

// Radix Dropdown/Dialog need the pointer APIs jsdom lacks.
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

const HOT_AZ: SavedViewFilters = { ...EMPTY_SAVED_VIEW_FILTERS, hot: true, state: "AZ" };
const PROBATE: SavedViewFilters = { ...EMPTY_SAVED_VIEW_FILTERS, tags: ["t1"], viewMode: "board" };
const VIEWS = [
  { id: "v1", name: "Hot in AZ", filters: HOT_AZ, updatedAt: "2026-08-15T10:00:00.000Z" },
  { id: "v2", name: "Probate follow-ups", filters: PROBATE, updatedAt: "2026-08-14T10:00:00.000Z" },
];

beforeEach(() => {
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockResolvedValue({ views: VIEWS });
  apiMutate.mockResolvedValue({ code: "ok" });
});

/** Renders the menu with controlled filters, so a test can drive "the page changed". */
function wrap(initial: SavedViewFilters = EMPTY_SAVED_VIEW_FILTERS) {
  const onApply = vi.fn();
  function Harness() {
    const [filters, setFilters] = React.useState(initial);
    return (
      <>
        <SavedViewsMenu
          filters={filters}
          onApply={(f) => {
            onApply(f);
            setFilters(f); // what the leads page does: the applied view becomes the state
          }}
        />
        <button onClick={() => setFilters((f) => ({ ...f, q: "edited" }))}>Edit filters</button>
      </>
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onApply };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("button", { name: /saved views/i }));

describe("SV-03: the views dropdown", () => {
  it("SV-03: lists the user's views and applies one on click", async () => {
    const user = userEvent.setup();
    const { onApply } = wrap();
    await openMenu(user);

    expect(await screen.findByRole("menuitem", { name: "Hot in AZ" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Probate follow-ups" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Hot in AZ" }));
    // SV-04: the WHOLE filter state, view mode included — not a merge.
    expect(onApply).toHaveBeenCalledExactlyOnceWith(HOT_AZ);
    // …and the trigger now carries the view's name.
    expect(await screen.findByRole("button", { name: /saved views — hot in az/i })).toBeInTheDocument();
  });

  it("SV-03: shows no counts (recorded decision — none rather than stale)", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    const item = await screen.findByRole("menuitem", { name: "Hot in AZ" });
    expect(item.textContent).toBe("Hot in AZ");
  });

  it("SV-03: an empty menu says so", async () => {
    apiGet.mockResolvedValue({ views: [] });
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    expect(await screen.findByText(/no saved views yet/i)).toBeInTheDocument();
  });

  it("SV-03: a failed roster read is reported with a retry, not an empty menu", async () => {
    apiGet.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    expect(await screen.findByText(/couldn't load your views/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("SV-04: the modified indicator", () => {
  it("SV-04: absent right after applying, present once the filters diverge", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Hot in AZ" }));

    expect(screen.queryByText("Modified")).toBeNull();
    await user.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(await screen.findByText("Modified")).toBeInTheDocument();
    // PRN-14: the state is stated in words (and in the trigger's accessible name), not by hue.
    expect(screen.getByRole("button", { name: /saved views — hot in az, modified/i })).toBeInTheDocument();
  });

  it("SV-04: with NO view applied there is nothing to diverge from", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /edit filters/i }));
    expect(screen.queryByText("Modified")).toBeNull();
    expect(await screen.findByRole("button", { name: "Saved views" })).toBeInTheDocument();
  });
});

describe("SV-03: save current filters", () => {
  it("SV-03: a NEW name POSTs the current filters", async () => {
    const user = userEvent.setup();
    apiMutate.mockResolvedValue({ id: "v9", name: "Unmatched this week" });
    wrap(HOT_AZ);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /save current filters/i }));

    await user.type(await screen.findByRole("textbox", { name: /view name/i }), "Unmatched this week");
    await user.click(screen.getByRole("button", { name: /save view/i }));

    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/saved-views", "POST", { name: "Unmatched this week", filters: HOT_AZ }),
    );
    // The new view becomes the applied one, so the trigger names it.
    expect(await screen.findByRole("button", { name: /unmatched this week/i })).toBeInTheDocument();
  });

  it("SV-03: an EXISTING name asks before it overwrites, then PATCHes that view", async () => {
    const user = userEvent.setup();
    wrap(HOT_AZ);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /save current filters/i }));

    // Case-insensitively — the same rule the unique index enforces.
    await user.type(await screen.findByRole("textbox", { name: /view name/i }), "hot IN az");
    await user.click(screen.getByRole("button", { name: /save view/i }));

    // Nothing has been sent yet: the question is the gate.
    expect(apiMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/already exists/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /overwrite view/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/saved-views/v1", "PATCH", { filters: HOT_AZ }));
  });

  it("SV-03: cancelling the save writes nothing", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /save current filters/i }));
    await user.type(await screen.findByRole("textbox", { name: /view name/i }), "Never saved");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /cancel/i }));
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("SV-03: a server-side duplicate (the 409 race) is reported in the dialog, not swallowed", async () => {
    const user = userEvent.setup();
    apiMutate.mockRejectedValue(new Error("You already have a view called “Race”."));
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /save current filters/i }));
    await user.type(await screen.findByRole("textbox", { name: /view name/i }), "Race");
    await user.click(screen.getByRole("button", { name: /save view/i }));

    expect(await screen.findByText(/already have a view called/i)).toBeInTheDocument();
    // The dialog stays open with the draft intact, so the operator can rename and retry.
    expect(screen.getByRole("textbox", { name: /view name/i })).toHaveValue("Race");
  });

  it("SV-03: the save box pre-fills with the APPLIED view's name (re-saving is the common gesture)", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Hot in AZ" }));
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /save current filters/i }));
    expect(await screen.findByRole("textbox", { name: /view name/i })).toHaveValue("Hot in AZ");
  });
});

describe("SV-03: delete a view", () => {
  it("SV-03: delete is CONFIRM-gated", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete view Hot in AZ" }));

    expect(apiMutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/leads and filters are not affected/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /delete view/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/saved-views/v1", "DELETE"));
  });

  it("SV-03: cancelling the confirmation deletes nothing", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete view Probate follow-ups" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /cancel/i }));
    expect(apiMutate).not.toHaveBeenCalled();
  });

  it("SV-04: deleting the APPLIED view drops the name but leaves the filters alone", async () => {
    const user = userEvent.setup();
    wrap();
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Hot in AZ" }));
    expect(await screen.findByRole("button", { name: /saved views — hot in az/i })).toBeInTheDocument();

    // The roster the refetch returns no longer carries it.
    apiGet.mockResolvedValue({ views: VIEWS.filter((v) => v.id !== "v1") });
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete view Hot in AZ" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /delete view/i }));

    expect(await screen.findByRole("button", { name: "Saved views" })).toBeInTheDocument();
  });
});
