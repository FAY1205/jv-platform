// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  availableStatuses: ["New", "Contacted", "Closed"],
  listing: { status: "no", link: null },
};

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => (url.includes("/notes") ? { notes: [] } : LEAD)),
}));

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
