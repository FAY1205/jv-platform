// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// WP-N6 T-8 — the leads list's selection surface: the checkbox column and its capability
// gate, the tri-state header, the escalation flip and its drop-back, the reset contract, and
// the result toast + skipped dialog.
//
// Every number the bar and the dialogs show is the SERVER's (N6-05), so the dry-run mock is
// the interesting fixture here: a test that let the client count checkboxes would be testing
// the wrong thing.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Stub() {
      return null;
    },
}));

const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate,
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); }
  },
}));

if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

import { LeadsView } from "@/app/(admin)/leads/leads-view";

const row = (refId: string) => ({
  refId,
  seller: `Seller ${refId}`,
  address: "18 Palo Verde Rd",
  city: "Phoenix",
  state: "AZ",
  zip: "85004",
  campaign: "Weekly",
  mlsStatus: "kept" as const,
  status: "New",
  scoreTotal: null,
  scoreGroup: null,
  partner: null,
  receivedAt: "2026-08-01T00:00:00.000Z",
  modifiedAt: null,
  tags: [],
});

const PAGE_1 = [row("LD-26-70001"), row("LD-26-70002")];
const PAGE_2 = [row("LD-26-70003")];
const TOTAL = 641;

let capabilities: string[] = ["leads.read", "leads.write"];
const posted: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  capabilities = ["leads.read", "leads.write"];
  posted.length = 0;
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.includes("/api/admin/partners")) return { partners: [{ id: "p1", refId: "JV-001", name: "Alpha", color: "#f4c95d" }] };
    if (url.includes("/api/leads/sources")) return { sources: [] };
    if (url.includes("/api/leads/counts")) return { total: 800, active: TOTAL, unmatched: 0 };
    if (url.includes("/api/tags")) return { tags: [{ id: "t1", name: "Probate", color: "amber", leadCount: 3 }], total: 1, limit: 100 };
    if (url.startsWith("/api/leads?")) {
      const page = Number(new URL(url, "http://x").searchParams.get("page") ?? 1);
      return { leads: page === 1 ? PAGE_1 : PAGE_2, page, pageSize: 2, total: TOTAL };
    }
    return { email: "a@dev.test", role: "admin", capabilities, workspace: { name: "W" }, notifications: [], unread: 0 };
  });
  apiMutate.mockImplementation(async (url: string, _method: string, body: Record<string, unknown>) => {
    posted.push({ url, body });
    if (body.dryRun) return { dryRun: true, total: 641, eligible: 596, skipped: { removedMls: 45 } };
    return {
      dryRun: false,
      total: 641,
      applied: 596,
      skipped: { removedMls: 45 },
      skippedRefs: [{ ref: "LD-26-70009", reason: "removedMls" }],
    };
  });
});

function renderLeads(props: { initialHot?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadsView initialQ="" initialHot={props.initialHot ?? false} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Async: the rows arrive with the list query, so every test starts by awaiting one. */
const rowBox = (refId: string) => screen.findByLabelText(`Select ${refId}`);
const headerBox = () => screen.getByLabelText("Select all leads on this page");
/** The bar's own live paragraph — the count is TEXT, never carried by the tint alone. */
const barText = () => screen.getByText(/selected/).closest("div")!.textContent!.replace(/\s+/g, " ");

describe("N6-52..56: leads bulk selection", () => {
  it("N6-52: a seat without leads.write gets no checkbox column at all", async () => {
    capabilities = ["leads.read"];
    renderLeads();
    await screen.findByText("Seller LD-26-70001");
    expect(screen.queryByLabelText("Select all leads on this page")).toBeNull();
    expect(screen.queryByLabelText("Select LD-26-70001")).toBeNull();
  });

  it("N6-53: selecting a row raises the bar with the page count and the escalation offer", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.click(await screen.findByLabelText("Select LD-26-70001"));
    expect(barText()).toContain("1 selected on this page");
    expect(screen.getByRole("button", { name: /Select all 641 matching this filter/ })).toBeTruthy();
  });

  it("N6-52: the header checkbox is tri-state and completes the page from a partial selection", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    expect(headerBox().getAttribute("aria-checked")).toBe("mixed");
    await user.click(headerBox());
    expect(headerBox().getAttribute("aria-checked")).toBe("true");
    expect(barText()).toContain("2 selected on this page");
  });

  it("N6-53: escalating re-tints the bar and names the filter in words", async () => {
    const user = userEvent.setup();
    renderLeads({ initialHot: true });
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByRole("button", { name: /Select all 641 matching this filter/ }));
    const bar = screen.getByText(/selected/).closest("div")!;
    expect(bar.className).toContain("bg-brand-soft");
    expect(bar.textContent).toContain("Hot only");
    expect(bar.textContent).toContain("641");
  });

  it("N6-51: touching a checkbox while escalated drops back to page mode, keeping the rest of the page", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByRole("button", { name: /Select all 641 matching this filter/ }));
    expect(barText()).toContain("641");
    // Un-tick one row: the escalation is off, and the OTHER visible row stays selected.
    await user.click(await rowBox("LD-26-70001"));
    expect(barText()).toContain("1 selected on this page");
    expect((await rowBox("LD-26-70002")).getAttribute("aria-checked")).toBe("true");
  });

  it("N6-51: the selection survives paging and dies on a filter change (owner A5)", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByLabelText("Next page"));
    await screen.findByText("Seller LD-26-70003");
    expect(barText()).toContain("1 selected on this page"); // survived the page change

    await user.click(screen.getByRole("button", { name: /Hot/ })); // any filter change
    await screen.findByText("Seller LD-26-70001");
    expect(screen.queryByText(/selected on this page/)).toBeNull();
  });

  it("N6-54: a selected row carries the brand-soft wash, distinct from the open record's ring", async () => {
    const user = userEvent.setup();
    renderLeads();
    const box = await rowBox("LD-26-70001");
    await user.click(box);
    const tr = box.closest("tr")!;
    expect(tr.className).toContain("bg-brand-soft");
    expect(tr.className).not.toContain("ring-brand");
  });

  it("N6-05/N6-14: the assign confirm names the SERVER's eligible count, not the checkbox count", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByRole("button", { name: "Assign…" }));
    await user.click(screen.getByRole("combobox", { name: "Assign to partner" }));
    await user.click(await screen.findByText("Alpha (JV-001)"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // 596, from the dry run — the client selected one row.
    const confirm = await screen.findByRole("button", { name: "Assign 596 leads" });
    expect(posted.filter((p) => p.body.dryRun === true)).toHaveLength(1);
    expect(screen.getByText(/clean status timeline/)).toBeTruthy();

    await user.click(confirm);
    // N6-55: the split, then the way into the detail.
    expect(await screen.findByText("Assigned 596 · skipped 45")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "View skipped" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Removed from MLS/)).toBeTruthy();
    expect(within(dialog).getByText(/LD-26-70009/)).toBeTruthy();
  });

  it("N6-50: an escalated action posts the FILTER, never an id list", async () => {
    const user = userEvent.setup();
    renderLeads({ initialHot: true });
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByRole("button", { name: /Select all 641 matching this filter/ }));
    await user.click(screen.getByRole("button", { name: "Status…" }));
    await user.click(screen.getByRole("radio", { name: "Contacted" }));
    await screen.findByRole("button", { name: "Update 596 leads" });
    const sent = posted.at(-1)!;
    expect(sent.url).toBe("/api/leads/bulk/status");
    expect((sent.body.selection as { mode: string }).mode).toBe("filter");
    expect(sent.body.selection).not.toHaveProperty("leadRefs");
    expect((sent.body.selection as { filters: Record<string, unknown> }).filters).toMatchObject({ hot: true });
  });
});
