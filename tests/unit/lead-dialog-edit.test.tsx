// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// N5-06 — status and partner as dedicated, always-visible record controls, and the
// ownership-move confirmation (ASN-03/FRM-03) they still pass through unchanged.

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

// Radix primitives (Select, Dialog) use pointer capture + scrollIntoView, neither of
// which jsdom implements. Stub them so the Select opens and options are clickable.
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

const partnerA = { id: "pa", refId: "JV-001", name: "Alpha", color: "#111111" };
const partnerB = { id: "pb", refId: "JV-002", name: "Beta", color: "#222222" };
const REF = "LD-26-00001";

type Detail = ReturnType<typeof leadDetail>;
function leadDetail(overrides: Record<string, unknown> = {}) {
  return {
    refId: REF,
    seller: { first: "Sam", last: "Lee", phone: "", email: "" },
    address: "", city: "", state: "", zip: "", campaign: "", notes: "",
    reasonForSelling: "", motivation: "", timeToSell: "",
    mlsStatus: "kept" as "kept" | "removed", mlsReason: "", status: "New",
    score: { total: null, group: null, status: "complete" as const, breakdown: null },
    editable: true, receivedAt: "2026-08-01T00:00:00.000Z", modifiedAt: null,
    partner: partnerA as typeof partnerA | null, // currently owned by Alpha
    assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: null, original: null as typeof partnerB | null },
    availableStatuses: ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"],
    activity: [],
    ...overrides,
  };
}

let detail: Detail = leadDetail();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url.includes("/api/me")) {
        return { email: "a@example.test", role: "admin", capabilities: ["leads.read", "leads.write", "work.write", "views.own"], workspace: { name: "W" }, isPlatformOwner: false };
      }
      if (url.includes("/notes")) return { notes: [] };
      if (url.includes("/tasks")) return { tasks: [] };
      if (url.includes("/partners")) return { partners: [partnerA, partnerB] };
      return detail;
    }),
  };
});

import { ToastProvider } from "@/components";
import { LeadDialog, partnerActionFor, REVERT, UNASSIGNED } from "@/app/(admin)/leads/lead-dialog";
import type { LeadDetail } from "@/app/(admin)/leads/lead-dialog";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadDialog refId={REF} onClose={vi.fn()} nav={null} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function stubFetch() {
  const spy = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ refId: REF }) }));
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

/** Choose an option in the always-visible partner control. */
async function choosePartner(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole("combobox", { name: /assigned partner/i }));
  await user.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  detail = leadDetail();
  vi.unstubAllGlobals();
});

// ── The ownership-change decision (pure) ──────────────────────────────────────
describe("ASN-03: partnerActionFor — which selections move ownership", () => {
  const d = leadDetail() as unknown as LeadDetail; // owned by Alpha (pa)
  it("keep: selecting the current owner is a no-op", () => {
    expect(partnerActionFor("pa", d)).toEqual({ action: "keep" });
  });
  it("set: selecting a different partner transfers ownership", () => {
    expect(partnerActionFor("pb", d)).toEqual({ action: "set", partnerId: "pb" });
  });
  it("unassign: clearing an assigned lead removes the owner", () => {
    expect(partnerActionFor(UNASSIGNED, d)).toEqual({ action: "unassign" });
  });
  it("revert: the revert sentinel returns the lead to its original routing", () => {
    expect(partnerActionFor(REVERT, d)).toEqual({ action: "revert" });
  });
  it("keep: clearing an already-unassigned lead is a no-op (nothing to unassign)", () => {
    expect(partnerActionFor(UNASSIGNED, leadDetail({ partner: null }) as unknown as LeadDetail)).toEqual({ action: "keep" });
  });
});

// ── The dedicated controls (N5-06) ────────────────────────────────────────────
describe("N5-06: status and partner are always-visible controls, not form fields", () => {
  it("N5-06: both controls are on the record with no edit mode to enter first", async () => {
    stubFetch();
    renderPanel();
    expect(await screen.findByRole("combobox", { name: /status for LD-26-00001/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /assigned partner/i })).toBeInTheDocument();
    // The whole-view Edit toggle is gone (N5-13).
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });

  it("N5-06/PRN-14: the partner control carries the owner's NAME and ref ID, not just a color", async () => {
    stubFetch();
    renderPanel();
    const trigger = await screen.findByRole("combobox", { name: /assigned partner/i });
    expect(within(trigger).getByText(/Alpha/)).toBeInTheDocument();
    expect(within(trigger).getByText(/JV-001/)).toBeInTheDocument();
  });

  it("N5-06: the status control offers exactly the record's availableStatuses", async () => {
    const user = userEvent.setup();
    stubFetch();
    detail = leadDetail({ availableStatuses: ["New", "Contacted"] });
    renderPanel();

    await user.click(await screen.findByRole("combobox", { name: /status for/i }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["New", "Contacted"]);
  });

  it("N5-06/PRN-04: a removed-MLS lead keeps the READ-ONLY status treatment — a badge, not a control", async () => {
    stubFetch();
    detail = leadDetail({ mlsStatus: "removed", editable: false, status: "Removed MLS" });
    renderPanel();

    await screen.findByRole("combobox", { name: /assigned partner/i }); // the record has loaded
    expect(screen.queryByRole("combobox", { name: /status for/i })).toBeNull();
    expect(screen.getAllByText(/Removed · MLS/).length).toBeGreaterThan(0);
  });
});

// ── The confirm gate (ASN-03 / FRM-03) ────────────────────────────────────────
describe("ASN-03/FRM-03: reassigning a lead is confirmed before it is written", () => {
  it("changing the assigned partner asks for confirmation (naming the lead + destination) before any PATCH; confirming then writes the transfer", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await choosePartner(user, /Beta \(JV-002\)/i);

    // Selecting does NOT write — it raises a confirmation naming the lead and the destination.
    const confirm = await screen.findByRole("dialog", { name: /reassign this lead/i });
    expect(within(confirm).getByText(REF)).toBeInTheDocument();
    expect(within(confirm).getByText(/Beta/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: /^reassign$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/leads/${REF}`);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ partner: { action: "set", partnerId: "pb" } });
  });

  it("cancelling the confirmation writes nothing and leaves the owner alone", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await choosePartner(user, /Beta \(JV-002\)/i);
    const confirm = await screen.findByRole("dialog", { name: /reassign this lead/i });
    await user.click(within(confirm).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /reassign this lead/i })).toBeNull());
    expect(fetchSpy).not.toHaveBeenCalled();
    const trigger = screen.getByRole("combobox", { name: /assigned partner/i });
    expect(within(trigger).getByText(/Alpha/)).toBeInTheDocument();
  });

  it("selecting the CURRENT owner is a no-op — no confirmation, no request", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await choosePartner(user, /Alpha \(JV-001\)/i);

    expect(screen.queryByRole("dialog", { name: /reassign this lead/i })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("revert: reverting a manually-overlaid lead to its original routing is confirmed, then PATCHes a revert action", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    // Manually overlaid onto Alpha, with Beta as the original pipeline routing → "Revert" is offered.
    detail = leadDetail({ partner: partnerA, assignment: { manual: true, assignedAt: null, matchMethod: "zip", matchedOn: null, original: partnerB } });
    renderPanel();

    await choosePartner(user, /revert to original routing/i);
    const confirm = await screen.findByRole("dialog", { name: /revert this lead/i });
    expect(within(confirm).getByText(/Beta/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: /revert routing/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ partner: { action: "revert" } });
  });

  it("unassign: clearing the owner is confirmed with accurate copy (no 'new owner'), then PATCHes an unassign action", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    // Manually assigned to Alpha with NO pipeline snapshot underneath → "Unassigned" is offered.
    detail = leadDetail({ partner: partnerA, assignment: { manual: true, assignedAt: null, matchMethod: "manual", matchedOn: null, original: null } });
    renderPanel();

    await choosePartner(user, /^unassigned$/i);
    const confirm = await screen.findByRole("dialog", { name: /unassign this lead/i });
    // F-4/FRM-03: accurate consequence — an unassign has no "new owner".
    expect(within(confirm).queryByText(/new owner/i)).toBeNull();
    expect(within(confirm).getByText(/unassigned pool/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: /^unassign$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ partner: { action: "unassign" } });
  });
});
