// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const { apiGet, apiMutate, apiDownload } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn(), apiDownload: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate,
  apiDownload,
  ApiError: class ApiError extends Error {
    constructor(message: string) { super(message); }
  },
}));

import { ApiError } from "@/lib/api";

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
  apiDownload.mockReset();
  apiDownload.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    posted.push({ url, body });
  });
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
/** The VISIBLE bar. Addressed by its group name rather than by matching text, because the
 *  permanently-mounted sr-only live region (A11Y-03) deliberately mirrors the same sentence —
 *  a text query would match both. The count is TEXT in each, never carried by the tint alone. */
const bar = () => screen.getByRole("group", { name: "Selection actions" });
const barText = () => bar().textContent!.replace(/\s+/g, " ");
/** What a screen reader is told, which must survive the bar being absent at zero. */
const announced = () => screen.getByRole("status", { name: "Selection status" }).textContent!.replace(/\s+/g, " ");
/**
 * The VISIBLE toast rows, as text. Scoped to the stack rather than queried by text, because a
 * toast with NO action renders its message twice — once in the pill and once in the provider's
 * sr-only live region (R-56) — and a bare `findByText` matches both, then fails as
 * "found multiple". (A toast WITH an action escapes that only by accident: the live region
 * appends ". <action label>", so the two strings differ.) The page mounts its own provider
 * inside the harness's, hence `getAllByTestId`.
 */
const toastText = (expected: string | RegExp) =>
  waitFor(() => {
    const text = screen.getAllByTestId("toast-stack").map((s) => s.textContent ?? "").join(" ");
    expect(text).toMatch(expected);
  });

describe("N6-52..56: leads bulk selection", () => {
  it("N6-52: a seat that can neither write nor export gets no checkbox column at all", async () => {
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
    expect(bar().className).toContain("bg-brand-soft");
    expect(barText()).toContain("Hot only");
    expect(barText()).toContain("641");
    expect(announced()).toContain("Hot only");
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
    expect(screen.queryByRole("group", { name: "Selection actions" })).toBeNull();
    // A11Y-03: the live region OUTLIVES the bar — it is what announces the next 0→1 — and
    // goes quiet rather than unmounting.
    expect(announced()).toBe("");
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

  // ── Export selected (N6-40..44, N6-53) ──────────────────────────────────────

  it("N6-52/N6-53: an EXPORT-only seat gets checkboxes and only the Export action", async () => {
    // The two capabilities are independent. A read-only analyst who may export still needs the
    // selection surface; what they must not see is a mutation they cannot perform.
    capabilities = ["leads.read", "data.export"];
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    expect(screen.getByRole("button", { name: "Export…" })).toBeTruthy();
    for (const absent of ["Status…", "Tags…", "Assign…"]) {
      expect(screen.queryByRole("button", { name: absent })).toBeNull();
    }
  });

  it("N6-53: Export is absent for a seat that can write but not export", async () => {
    // Absence, not disabled state — a disabled control advertises a capability this seat will
    // never have (the §8 absence-not-presence rule).
    const user = userEvent.setup();
    renderLeads(); // default capabilities: leads.read + leads.write
    await user.click(await rowBox("LD-26-70001"));
    expect(screen.getByRole("button", { name: "Assign…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export…" })).toBeNull();
  });

  it("N6-40/N6-43: the export dialog states the shape and the retention, then downloads the selection", async () => {
    capabilities = ["leads.read", "leads.write", "data.export"];
    const user = userEvent.setup();
    renderLeads();
    await user.click(await rowBox("LD-26-70001"));
    await user.click(await rowBox("LD-26-70002"));
    await user.click(screen.getByRole("button", { name: "Export…" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2/)).toBeTruthy();
    expect(within(dialog).getByText(".xlsx — the fixed 18-column layout")).toBeTruthy();
    expect(within(dialog).getByText("Leads (by partner) · Color legend · Selection summary")).toBeTruthy();
    expect(within(dialog).getByText(/Color coding follows your workspace setting/)).toBeTruthy();
    expect(within(dialog).getByText(/nothing is stored/)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Download" }));
    const sent = posted.at(-1)!;
    expect(sent.url).toBe("/api/leads/export");
    expect(sent.body.selection).toEqual({ mode: "refs", leadRefs: ["LD-26-70001", "LD-26-70002"] });
    // N6-05 does not apply: an export resolves no eligibility, so it never dry-runs.
    expect(posted.some((p) => p.body.dryRun === true)).toBe(false);
    await toastText("Export downloaded");
    // Nothing changed, so the selection survives — "export, then assign the same set".
    expect(barText()).toContain("2 selected on this page");
  });

  it("N6-40: an escalated export posts the FILTER, and a failure keeps the selection", async () => {
    capabilities = ["leads.read", "data.export"];
    // The real envelope the route raises when a selection resolves to nothing (N6-40). Built
    // with the FULL `ApiError` signature — the module mock only replaces the runtime class, so
    // the constructor is still type-checked against the real one.
    apiDownload.mockRejectedValue(
      new ApiError("Your selection is no longer available — close this and reselect.", "empty_selection", "trace-1", 400),
    );
    const user = userEvent.setup();
    renderLeads({ initialHot: true });
    await user.click(await rowBox("LD-26-70001"));
    await user.click(screen.getByRole("button", { name: /Select all 641 matching this filter/ }));
    await user.click(screen.getByRole("button", { name: "Export…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Download" }));

    const sent = apiDownload.mock.calls.at(-1)!;
    expect(sent[0]).toBe("/api/leads/export");
    expect((sent[1] as { selection: { mode: string; filters: Record<string, unknown> } }).selection.mode).toBe("filter");
    expect((sent[1] as { selection: { filters: Record<string, unknown> } }).selection.filters).toMatchObject({ hot: true });
    // The uniform envelope's own sentence, and the selection is preserved for the retry.
    await toastText(/no longer available/);
    // The dialog stays open so the operator can retry without rebuilding anything; the bar is
    // only reachable again once it closes (the house Dialog hides the rest of the a11y tree).
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(barText()).toContain("641");
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
