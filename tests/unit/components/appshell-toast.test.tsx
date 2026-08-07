// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ADR-0030: AppShell owns the ToastProvider, so no admin page has to remember to mount
// one. Before this, useToast was reachable from shared leaves (LeadDialog, StatusSelect)
// that a page could compose with no signal it had taken on a provider requirement —
// /imports/[ref] threw "useToast must be used within <ToastProvider>" on every render and
// /partners/[id] threw as soon as a lead row was opened.
//
// Shell render harness follows appshell-assistant.test.tsx: a real QueryClientProvider
// (NotificationBell/ProfileMenu use real useQuery/useMutation) + stubbed fetch, rather
// than mocking @tanstack/react-query.

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async () => ({
    count: 0,
    email: "admin@dev.test",
    role: "admin",
    workspace: { name: "W" },
    notifications: [],
    unread: 0,
  })),
}));

import { AppShell } from "@/components/AppShell";
import { useToast } from "@/components/Toast";

afterEach(() => vi.unstubAllGlobals());

// A stand-in for the shared leaves (LeadDialog/StatusSelect) that call useToast without
// knowing which page mounted them.
function ToastingChild() {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast("Import voided.", "success")}>
      fire toast
    </button>
  );
}

function renderShell(children: React.ReactNode) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell>{children}</AppShell>
    </QueryClientProvider>,
  );
}

describe("UXQ-03: AppShell owns the toast provider (ADR-0030)", () => {
  it("UXQ-03: a child calling useToast renders inside AppShell with no page-level ToastProvider", () => {
    // The /imports/[ref] regression: RunView called useToast directly and threw on first
    // render, so the whole page fell to the Next error boundary.
    expect(() => renderShell(<ToastingChild />)).not.toThrow();
    expect(screen.getByRole("button", { name: "fire toast" })).toBeInTheDocument();
  });

  it("UXQ-03: toast() from a child surfaces the message in the shell's live region", async () => {
    const user = userEvent.setup();
    renderShell(<ToastingChild />);

    expect(screen.queryByText("Import voided.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "fire toast" }));

    // Scope to the visible stack: the message also lives in the sr-only announcer (R-56).
    expect(await within(screen.getByTestId("toast-stack")).findByText("Import voided.")).toBeInTheDocument();
    // Toasts announce politely rather than stealing focus (UXQ-03).
    expect(screen.getByRole("status")).toHaveTextContent("Import voided.");
  });

  it("UXQ-03: the shell mounts exactly one toast live region (no nested duplicate)", () => {
    // Guards the other half of ADR-0030: pages that used to mount their own provider had
    // it removed, so the shell must be the single live region — two would double-announce.
    renderShell(<ToastingChild />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
