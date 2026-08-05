// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusSelect, NotesPanel, ToastProvider } from "@/components";

// WS-3 component coverage: the async/optimistic bits the pr-review flagged as untested.
// Radix Select's pointer-driven dropdown isn't reliably operable in jsdom, so the
// status-change optimistic/revert cycle is left to the portal E2E (TST-07); here we cover
// the read-only gating (PRN-04) and NotesPanel's save-error surfacing (F-20).

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("StatusSelect", () => {
  it("PRN-04: a removed lead renders the read-only verdict badge, never a control", () => {
    wrap(<StatusSelect refId="LD-26-1" status="New" mlsStatus="removed" />);
    expect(screen.getByText("Removed · MLS")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("a kept lead renders a status combobox showing the current status", () => {
    wrap(<StatusSelect refId="LD-26-2" status="Contacted" mlsStatus="kept" />);
    const trigger = screen.getByRole("combobox", { name: "Status for LD-26-2" });
    expect(trigger).toHaveTextContent("Contacted");
  });
});

describe("NotesPanel (F-20: save errors surface)", () => {
  it("F-20: a failed add shows an alert and re-enables the field instead of failing silently", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts?: RequestInit) => {
        if (opts?.method === "POST" || opts?.method === "PATCH") {
          return { ok: false, status: 500, json: async () => ({ message: "boom" }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ notes: [] }) } as Response;
      }),
    );

    wrap(<NotesPanel leadRef="LD-26-3" title="Admin notes" />);

    const field = await screen.findByLabelText("Add a note");
    await user.type(field, "Called the seller");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    const alert = await screen.findByRole("alert");
    // R-51: the server's real reason ("boom") now surfaces instead of a generic string that
    // hid it — a rate-limit / PRN-13 scope rejection must reach the user, not be swallowed.
    expect(alert).toHaveTextContent("boom");
    expect(field).not.toBeDisabled();
  });
});
