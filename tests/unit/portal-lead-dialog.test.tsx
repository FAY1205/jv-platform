// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portalLeadsKey, portalLeadsParams } from "@/modules/portal/leads-contract";

const LEAD = {
  refId: "JV-2001",
  seller: { first: "Ana", last: "Ruiz", phone: "(859) 938-9128", email: "ana@example.test" },
  address: "20 Bluffside Dr",
  city: "Covington",
  state: "KY",
  zip: "41017",
  reasonForSelling: "Relocation / moving",
  motivation: "SHOULD NOT APPEAR",
  timeToSell: "Within 1-3 months",
  notes: "Some source notes",
  receivedAt: "2026-08-04T15:33:00.000Z",
  status: "New",
  history: [{ status: "New", changedAt: "2026-08-04T15:33:00.000Z" }],
  // TSK-06: the unified timeline — WP-TSK-4 added TasksPanel + Timeline to this dialog,
  // both of which read this array (Timeline directly; TasksPanel via its own endpoint).
  activity: [{ kind: "imported", at: "2026-08-04T15:33:00.000Z", label: "Lead received", actor: null }],
  availableStatuses: ["New", "Contacted", "Closed"],
  listing: { status: "no", link: null },
};

const defaultApiGet = async (url: string) => (url.includes("/notes") ? { notes: [] } : url.includes("/tasks") ? { tasks: [] } : LEAD);
vi.mock("@/lib/api", () => ({
  // TasksPanel's GET (/api/leads/[ref]/tasks) is a different endpoint from the lead
  // detail/notes fetches this fixture already stubs — route it to an empty list too.
  apiGet: vi.fn(async (url: string) => (url.includes("/notes") ? { notes: [] } : url.includes("/tasks") ? { tasks: [] } : LEAD)),
}));

import { apiGet } from "@/lib/api";
import { ToastProvider } from "@/components";
import { PortalLeadDialog } from "@/app/portal/leads/portal-lead-dialog";

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PortalLeadDialog refId="JV-2001" onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("VP-4: PortalLeadDialog carries every partner feature from the old page", () => {
  it("shows seller, tap-to-call/mail, reason, time to sell, history, your notes, and an editable status", async () => {
    renderDialog();
    expect(await screen.findByText("Ana Ruiz")).toBeTruthy();
    expect(screen.getByRole("link", { name: "(859) 938-9128" })).toHaveAttribute("href", "tel:8599389128");
    expect(screen.getByRole("link", { name: "ana@example.test" })).toHaveAttribute("href", "mailto:ana@example.test");
    expect(screen.getByText("Relocation / moving")).toBeTruthy();
    expect(screen.getByText("Within 1-3 months")).toBeTruthy();
    expect(screen.getByText("Status history")).toBeTruthy();
    expect(screen.getByText("Your notes")).toBeTruthy();
    // The inline editable status control (StatusSelect, portal scope) — Radix trigger.
    expect(screen.getByRole("combobox", { name: /status for JV-2001/i })).toBeTruthy();
  });

  it("VP-4c: drops the always-empty Motivation field", async () => {
    renderDialog();
    await screen.findByText("Ana Ruiz");
    expect(screen.queryByText("Motivation")).toBeNull();
    expect(screen.queryByText("SHOULD NOT APPEAR")).toBeNull();
  });
});

// C-41b: the tapped row already carries the seller, address and status — a partner should
// see them at once, not five skeleton bars, while the detail loads behind them.
describe("C-41b: PortalLeadDialog renders from the list cache while the detail loads", () => {
  // The row as the portal list caches it (C-41a key): separate sellerFirst/sellerLast, and
  // none of the phone/email/reason/history the detail adds.
  const ROW = {
    refId: "JV-2001", sellerFirst: "Ana", sellerLast: "Ruiz",
    address: "20 Bluffside Dr", city: "Covington", state: "KY", zip: "41017",
    receivedAt: "2026-08-04T15:33:00.000Z", status: "New", scoreTotal: null, scoreGroup: null,
  };

  afterEach(() => {
    vi.mocked(apiGet).mockImplementation(defaultApiGet);
  });

  it("C-41b: the row's identity paints immediately; detail-only fields wait, then fill in", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.includes("/notes")) return { notes: [] };
      if (url.includes("/tasks")) return { tasks: [] };
      await gate;
      return LEAD;
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(portalLeadsKey(portalLeadsParams()), { leads: [ROW], page: 1, pageSize: 20, total: 1 });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PortalLeadDialog refId="JV-2001" onClose={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    // From the cached row, with no detail round trip completed.
    expect(await screen.findByText("Ana Ruiz")).toBeTruthy();
    expect(screen.getByText(/20 Bluffside Dr/)).toBeTruthy();
    // Detail-only: the phone a partner is about to call is NOT guessed from the row.
    expect(screen.queryByRole("link", { name: "(859) 938-9128" })).toBeNull();
    expect(screen.queryByText("Relocation / moving")).toBeNull();

    release();
    expect(await screen.findByText("Relocation / moving")).toBeTruthy();
    expect(screen.getByRole("link", { name: "(859) 938-9128" })).toHaveAttribute("href", "tel:8599389128");
  });
});
