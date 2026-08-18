// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// ADR-0049 §11.4 — the tenant permissions editor. The security-relevant properties are
// STRUCTURAL: the admin-locked band has no toggle to click, the always-on floor has no toggle
// to clear, and the PATCH body carries the editable selection only. Those are pinned here;
// the server re-validates every key (locked/unknown ⇒ loud 400).

const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate,
  ApiError: class ApiError extends Error {},
}));

import { PermissionsCard } from "@/app/(admin)/settings/team/permissions-card";

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

const MEMBER_DEFAULTS = ["ai.use", "ingest.run", "leads.read", "leads.write", "views.own", "work.write"];
const VIEWER_DEFAULTS = ["leads.read", "views.own"];

const PERMISSIONS = {
  defaults: { member: MEMBER_DEFAULTS, viewer: VIEWER_DEFAULTS },
  effective: { member: MEMBER_DEFAULTS, viewer: VIEWER_DEFAULTS },
  configured: { member: false, viewer: false },
  editable: ["ai.use", "data.export", "ingest.run", "leads.write", "partners.manage", "rules.manage", "runs.void", "work.write"],
  alwaysOn: ["leads.read", "views.own"],
  adminLocked: ["ops.admin", "settings.manage", "team.manage"],
};

beforeEach(() => {
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockResolvedValue(PERMISSIONS);
  apiMutate.mockResolvedValue(PERMISSIONS);
});

function wrap(expanded = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PermissionsCard expanded={expanded} onToggle={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("TM-12: the permissions matrix card", () => {
  it("is collapsed by default — the toggle carries aria-expanded and no table renders", async () => {
    wrap(false);
    const toggle = screen.getByRole("button", { name: /What each role can do/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the three bands from the server payload, in band order", async () => {
    wrap();
    expect(await screen.findByText("Upload & process files")).toBeInTheDocument();
    // Always-on floor: labelled, never a toggle.
    expect(screen.getByText("View dashboards & leads")).toBeInTheDocument();
    expect(screen.getAllByText("Always on").length).toBe(2);
    expect(screen.queryByRole("checkbox", { name: "View dashboards & leads for Member" })).toBeNull();
    // Admin-locked band: a lock, and no toggle for either tier (structurally ungrantable).
    expect(screen.getByText("Manage team")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Manage team for Member" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Manage team for Viewer" })).toBeNull();
    expect(screen.getAllByText("Only admins can hold this.").length).toBeGreaterThan(0);
  });

  it("PRN-14: every matrix cell carries sr-only Yes/No, never a colour alone", async () => {
    wrap();
    await screen.findByText("Upload & process files");
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
  });

  it("Save is disabled until the draft is dirty, then PATCHes the EDITABLE selection only", async () => {
    const user = userEvent.setup();
    wrap();
    const save = await screen.findByRole("button", { name: "Save permissions" });
    expect(save).toBeDisabled();

    // Grant Members the ability to void a run — off by default.
    const cell = screen.getByRole("checkbox", { name: "Void / recall runs for Member" });
    expect(cell).toHaveAttribute("aria-checked", "false");
    await user.click(cell);
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/permissions", "PATCH", {
        // The always-on floor (leads.read / views.own) is NOT in the body — the server
        // re-unions it at read time and Zod rejects anything outside the editable band.
        member: ["leads.write", "work.write", "ingest.run", "runs.void", "ai.use"],
        viewer: [],
      }),
    );
    expect((await screen.findAllByText("Permissions saved.")).length).toBeGreaterThan(0);
  });

  it("clearing an editable grant is equally a draft edit", async () => {
    const user = userEvent.setup();
    wrap();
    const cell = await screen.findByRole("checkbox", { name: "Upload & process files for Member" });
    expect(cell).toHaveAttribute("aria-checked", "true");
    await user.click(cell);
    expect(screen.getByRole("button", { name: "Save permissions" })).toBeEnabled();
  });

  it("Reset to defaults is inert until the tier has a stored row", async () => {
    wrap();
    expect(await screen.findByRole("button", { name: "Reset Member to defaults" })).toBeDisabled();
  });

  it("Reset to defaults confirms (naming the defaults) and PATCHes null for that tier", async () => {
    apiGet.mockResolvedValue({ ...PERMISSIONS, configured: { member: true, viewer: false } });
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: "Reset Member to defaults" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reset Member permissions?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Upload & process files/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() =>
      expect(apiMutate).toHaveBeenCalledWith("/api/admin/team/permissions", "PATCH", { member: null }),
    );
  });

  it("surfaces a retryable error state when the payload can't be loaded", async () => {
    apiGet.mockRejectedValue(new Error("nope"));
    wrap();
    expect(await screen.findByText("Couldn't load permissions")).toBeInTheDocument();
  });
});
