// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

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

import { EditForm, partnerActionFor, REVERT, UNASSIGNED } from "@/app/(admin)/leads/lead-dialog";
import type { LeadDetail } from "@/app/(admin)/leads/lead-dialog";

const partnerA = { id: "pa", refId: "JV-001", name: "Alpha", color: "#111111" };
const partnerB = { id: "pb", refId: "JV-002", name: "Beta", color: "#222222" };

function leadDetail(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    refId: "LD-26-00001",
    seller: { first: "Sam", last: "Lee", phone: "", email: "" },
    address: "", city: "", state: "", zip: "", campaign: "", notes: "",
    reasonForSelling: "", motivation: "", timeToSell: "",
    mlsStatus: "kept", mlsReason: "", status: "New",
    score: { total: null, group: null, status: "complete", breakdown: null },
    editable: true, receivedAt: "2026-08-01T00:00:00.000Z", modifiedAt: null,
    partner: partnerA, // currently owned by Alpha
    assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: null, original: null },
    availableStatuses: ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"],
    activity: [],
    ...overrides,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

// ── The ownership-change decision (pure) ──────────────────────────────────────
describe("ASN-03: partnerActionFor — which selections move ownership", () => {
  const d = leadDetail(); // owned by Alpha (pa)
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
    expect(partnerActionFor(UNASSIGNED, leadDetail({ partner: null }))).toEqual({ action: "keep" });
  });
});

// ── The confirm gate (ASN-03 / FRM-03) ────────────────────────────────────────
describe("ASN-03/FRM-03: reassigning a lead is confirmed before it is written", () => {
  it("changing the assigned partner asks for confirmation (naming the lead + destination) before any PATCH; confirming then writes the transfer", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<EditForm d={leadDetail()} partners={[partnerA, partnerB]} onCancel={vi.fn()} onSaved={vi.fn()} />);

    // Move the owner Alpha → Beta.
    await user.click(screen.getByRole("combobox", { name: /assigned partner/i }));
    await user.click(await screen.findByRole("option", { name: /Beta \(JV-002\)/i }));

    // Saving does NOT write yet — it raises a confirmation naming the lead and the destination.
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    const confirm = await screen.findByRole("dialog", { name: /reassign this lead/i });
    expect(within(confirm).getByText(/LD-26-00001/)).toBeInTheDocument();
    expect(within(confirm).getByText(/Beta/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Confirming performs the transfer PATCH with the set action.
    await user.click(within(confirm).getByRole("button", { name: /^reassign$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/leads/LD-26-00001");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string).partner).toEqual({ action: "set", partnerId: "pb" });

    vi.unstubAllGlobals();
  });

  it("saving with no ownership change writes straight through — no confirmation dialog", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<EditForm d={leadDetail()} partners={[partnerA, partnerB]} onCancel={vi.fn()} onSaved={vi.fn()} />);

    // Edit a plain field, leave the owner as Alpha.
    await user.type(screen.getByLabelText(/^City$/i), "Austin");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^reassign$/i })).toBeNull(); // never asked to confirm
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/leads/LD-26-00001");
    expect(JSON.parse(opts.body as string).partner).toEqual({ action: "keep" });

    vi.unstubAllGlobals();
  });

  it("revert: reverting a manually-overlaid lead to its original routing is confirmed, then PATCHes a revert action", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    // Manually overlaid onto Alpha, with Beta as the original pipeline routing → "Revert" is offered.
    const d = leadDetail({ partner: partnerA, assignment: { manual: true, assignedAt: null, matchMethod: "zip", matchedOn: null, original: partnerB } });
    wrap(<EditForm d={d} partners={[partnerA, partnerB]} onCancel={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("combobox", { name: /assigned partner/i }));
    await user.click(await screen.findByRole("option", { name: /revert to original routing/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    const confirm = await screen.findByRole("dialog", { name: /revert this lead/i });
    expect(within(confirm).getByText(/Beta/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: /revert routing/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string).partner).toEqual({ action: "revert" });

    vi.unstubAllGlobals();
  });

  it("unassign: clearing the owner is confirmed with accurate copy (no 'new owner'), then PATCHes an unassign action", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    // Manually assigned to Alpha with NO pipeline snapshot underneath → "Unassigned" is offered.
    const d = leadDetail({ partner: partnerA, assignment: { manual: true, assignedAt: null, matchMethod: "manual", matchedOn: null, original: null } });
    wrap(<EditForm d={d} partners={[partnerA, partnerB]} onCancel={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("combobox", { name: /assigned partner/i }));
    await user.click(await screen.findByRole("option", { name: /^unassigned$/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    const confirm = await screen.findByRole("dialog", { name: /unassign this lead/i });
    // F-4/FRM-03: accurate consequence — an unassign has no "new owner".
    expect(within(confirm).queryByText(/new owner/i)).toBeNull();
    expect(within(confirm).getByText(/unassigned pool/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: /^unassign$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opts.body as string).partner).toEqual({ action: "unassign" });

    vi.unstubAllGlobals();
  });
});

// ── The dirty-form discard guard (R-54 / FRM-02a) ─────────────────────────────
describe("R-54: EditForm reports dirtiness so the host dialog guards a dismiss", () => {
  it("reports not-dirty on mount (baseline = the loaded record) and dirty once a field changes", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    wrap(<EditForm d={leadDetail()} partners={[partnerA, partnerB]} onCancel={vi.fn()} onSaved={vi.fn()} onDirtyChange={onDirtyChange} />);

    // Seeds from `d` synchronously → the baseline is the loaded record, so it starts clean.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText(/^City$/i), "Austin");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });
});
