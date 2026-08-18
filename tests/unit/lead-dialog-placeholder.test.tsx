// @vitest-environment jsdom
import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// C-41b: the admin lead dialog paints the identity the clicked row already carries instead of
// six skeleton bars, then background-fetches the rest. This proves the SIGNAL (placeholderData
// + isPlaceholderData) end to end; lead-placeholder.test.ts proves the reshape itself.

// Radix Dialog uses pointer capture + scrollIntoView, neither of which jsdom implements.
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
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

const DETAIL = {
  refId: "LD-26-00929",
  seller: { first: "Robert", last: "Thompson", phone: "(859) 938-9128", email: "rt@example.test" },
  address: "8193 Maple St",
  city: "Dallas",
  state: "TX",
  zip: "75045",
  campaign: "Direct mail",
  notes: "",
  reasonForSelling: "Relocation / moving",
  motivation: "",
  timeToSell: "Within 1-3 months",
  mlsStatus: "kept" as const,
  mlsReason: "",
  status: "New",
  score: { total: 41, group: "hot" as const, status: "complete" as const, breakdown: null },
  editable: true,
  receivedAt: "2026-08-13T10:00:00.000Z",
  modifiedAt: null,
  partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
  assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: "75045", original: null },
  availableStatuses: ["New", "Contacted"],
  activity: [],
};

// The cached list row that opened the dialog — the ONE seller string, no phone/email/reason.
const ROW = {
  refId: "LD-26-00929",
  seller: "Robert Thompson",
  address: "8193 Maple St",
  city: "Dallas",
  state: "TX",
  zip: "75045",
  campaign: "Direct mail",
  mlsStatus: "kept" as const,
  status: "New",
  scoreTotal: 41,
  scoreGroup: "hot" as const,
  partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
  receivedAt: "2026-08-13T10:00:00.000Z",
  modifiedAt: null,
  tags: [],
};

// The detail fetch is held open so the placeholder render is observable; notes/tasks/partners
// resolve immediately (they are independent queries keyed on the ref).
let releaseDetail: () => void = () => {};
let detailGate = Promise.resolve();
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes("/notes")) return { notes: [] };
    if (url.includes("/tasks")) return { tasks: [] };
    if (url.includes("/partners")) return { partners: [] };
    await detailGate;
    return DETAIL;
  }),
}));

import { ToastProvider } from "@/components";
import { LeadDialog } from "@/app/(admin)/leads/lead-dialog";

function renderDialog({ seedList }: { seedList: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedList) qc.setQueryData(["leads", "q|received|desc", 1, 20], { leads: [ROW], page: 1, pageSize: 20, total: 1 });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadDialog refId="LD-26-00929" onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("C-41b: the admin lead dialog renders from the list cache while the detail loads", () => {
  it("C-41b: the row's identity paints immediately; detail-only fields wait, then fill in", async () => {
    detailGate = new Promise<void>((r) => { releaseDetail = r; });
    renderDialog({ seedList: true });

    // Straight from the cached row — no detail round trip has completed.
    expect(await screen.findByText("Robert Thompson")).toBeTruthy();
    expect(screen.getByText(/8193 Maple St/)).toBeTruthy();
    expect(screen.getByText("Direct mail")).toBeTruthy();
    // Detail-only — skeletons, not stale-looking blanks or a wrong "Not provided".
    expect(screen.queryByText("(859) 938-9128")).toBeNull();
    expect(screen.queryByText("Relocation / moving")).toBeNull();
    // Editing is held: EditForm seeds its baseline from `d`, and a partial baseline would
    // save blanks over real values.
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();

    releaseDetail();
    expect(await screen.findByText("Relocation / moving")).toBeTruthy();
    expect(screen.getByText("(859) 938-9128")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("C-41b: with no list cached (a ?open= deep link) it falls back to the full skeleton", async () => {
    detailGate = new Promise<void>((r) => { releaseDetail = r; });
    renderDialog({ seedList: false });

    // Nothing to seed from: no row identity on screen while the detail is in flight.
    expect(screen.queryByText("Robert Thompson")).toBeNull();
    releaseDetail();
    expect(await screen.findByText("Robert Thompson")).toBeTruthy();
  });
});
