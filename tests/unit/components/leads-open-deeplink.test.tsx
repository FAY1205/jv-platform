// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// SRCH-02 (pr-reviewer F-1) — the ?open=<ref> deep link the global search overlay
// navigates to. It has to work when /leads is ALREADY mounted (a client-side push
// re-renders the view with a new prop instead of remounting it), and it has to keep
// working for the SAME ref after the dialog is closed — which is why closing drops
// ?open= from the URL.

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));

// One stub for every next/dynamic import on this page. Only the lead dialog actually
// mounts here (the list view is the default preference), so the stub renders as it.
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub(props: { refId?: string; onClose?: () => void }) {
      if (!props.refId) return null;
      return (
        <div data-testid="lead-dialog">
          <span>{props.refId}</span>
          <button onClick={props.onClose}>Close lead</button>
        </div>
      );
    },
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes("/api/admin/partners")) return { partners: [] };
    if (url.includes("/api/leads/sources")) return { sources: [] };
    if (url.includes("/api/leads/unmatched/count")) return { count: 0 };
    if (url.includes("/api/leads/count")) return { count: 0 };
    if (url.startsWith("/api/leads?")) return { leads: [], page: 1, pageSize: 25, total: 0 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  }),
}));

import { LeadsView } from "@/app/(admin)/leads/leads-view";

const REF = "LD-26-90001";

beforeEach(() => {
  replace.mockClear();
  window.history.replaceState({}, "", `/leads?open=${REF}`);
});
afterEach(() => {
  vi.clearAllMocks();
});

function renderView(openRef: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (ref: string | null) => (
    <QueryClientProvider client={qc}>
      <LeadsView initialQ="" initialOpenRef={ref} />
    </QueryClientProvider>
  );
  const view = render(ui(openRef));
  return { ...view, show: (ref: string | null) => view.rerender(ui(ref)) };
}

describe("SRCH-02: /leads?open=<ref> deep link", () => {
  it("SRCH-02: a deep link arriving on an ALREADY-MOUNTED page opens the dialog", async () => {
    const { show } = renderView(null);
    expect(screen.queryByTestId("lead-dialog")).toBeNull();

    // What a client-side push from the search overlay looks like to this component.
    show(REF);
    expect(await screen.findByTestId("lead-dialog")).toHaveTextContent(REF);
  });

  it("SRCH-02: closing the dialog drops ?open= from the URL (no history entry)", async () => {
    const user = userEvent.setup();
    renderView(REF);
    await user.click(await screen.findByRole("button", { name: "Close lead" }));

    await waitFor(() => expect(screen.queryByTestId("lead-dialog")).toBeNull());
    expect(replace).toHaveBeenCalledWith("/leads", { scroll: false });
  });

  it("SRCH-02: close then reopen the SAME ref reopens the dialog", async () => {
    const user = userEvent.setup();
    const { show } = renderView(REF);
    expect(await screen.findByTestId("lead-dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close lead" }));
    await waitFor(() => expect(screen.queryByTestId("lead-dialog")).toBeNull());

    // The close cleared ?open=, so the page re-renders with a null prop first — which is
    // what makes the SAME ref a genuine change again rather than a silent no-op.
    show(null);
    expect(screen.queryByTestId("lead-dialog")).toBeNull();
    show(REF);
    expect(await screen.findByTestId("lead-dialog")).toHaveTextContent(REF);
  });

  it("SRCH-02: closing preserves the page's OTHER query params", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", `/leads?hot=1&open=${REF}`);
    renderView(REF);
    await user.click(await screen.findByRole("button", { name: "Close lead" }));
    expect(replace).toHaveBeenCalledWith("/leads?hot=1", { scroll: false });
  });
});
