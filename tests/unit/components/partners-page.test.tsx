// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

// UXF-10.1 (Scope-E audit §10.1): at 390px the roster's identity cell used to render the
// swatch + a clipped refId and NO partner name. The fix moved the refId onto its OWN line
// under the name and gave the column a min-width floor. These tests pin the STRUCTURE so a
// future edit can't silently re-collapse the refId back into the truncating name row.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  ApiError: class ApiError extends Error {},
}));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/partners",
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));

import { PartnersView } from "@/app/(admin)/partners/partners-view";

const partner = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "p1",
  refId: "PR-001",
  name: "Lone Star Buyers Collective of Greater Texas",
  email: "lone.star@example.com",
  phone: null,
  color: "amber",
  dealTerms: null,
  adminNotes: null,
  status: "active",
  isHouse: false,
  zipCount: 0,
  stateCount: 2,
  ...over,
});

beforeEach(() => {
  replace.mockClear();
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    // The edit form fetches ONE partner's detail (coverage lives there, not on the roster row).
    if (/\/api\/admin\/partners\/[^/]+$/.test(url)) {
      return { partner: { ...partner(), territory: { states: [], zips: [] } } };
    }
    if (url.includes("/api/admin/partners")) {
      return {
        partners: [
          partner(),
          // C-61: a partner with no email address on file — the roster's empty-value sentinel.
          partner({ id: "p2", refId: "PR-002", name: "Quiet Holdings", email: null, stateCount: 1 }),
          partner({ id: "house", refId: "HOUSE", name: "My Territory", isHouse: true, zipCount: 0, stateCount: 3 }),
        ],
      };
    }
    if (url.includes("/api/coverage")) return { states: [], counties: [], partners: [], coveredCount: 0 };
    if (url.includes("/count")) return { count: 0 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
});

function renderPage(initialEditId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PartnersView initialEditId={initialEditId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("UXF-10.1/10.2: partners roster identity + coverage cells", () => {
  it("UXF-10.1: the refId renders on its own line — a sibling of the name, not inside its truncating row", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: /lone star buyers collective/i });
    // The name and the reference ID are two separate lines inside the link: the refId
    // span is block-level and is NOT a descendant of the PartnerTag's truncating name span.
    const refId = within(link).getByLabelText("Reference PR-001");
    expect(refId).toHaveTextContent("PR-001");
    expect(refId.className).toContain("block");
    const name = within(link).getByText(/lone star buyers collective/i);
    expect(refId.contains(name)).toBe(false);
    expect(name.contains(refId)).toBe(false);
  });

  it("UXF-10.1: the identity column carries a min-width floor so it cannot be squeezed to nothing", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: /lone star buyers collective/i });
    const cell = link.closest("td");
    expect(cell).not.toBeNull();
    expect(cell!.className).toContain("min-w-");
  });

  it("UXF-10.2: zero coverage segments are omitted — roster row and House tile both read '2 states' / '3 states'", async () => {
    renderPage();
    await screen.findByRole("link", { name: /lone star buyers collective/i });
    // Roster row (zipCount 0 → no "0 ZIPs ·" prefix).
    expect(screen.getByText("2 states")).toBeInTheDocument();
    // House territory tile above the table (same formatter, F-1 review fix).
    expect(screen.getByText("3 states")).toBeInTheDocument();
    expect(screen.queryByText(/0 ZIPs/)).not.toBeInTheDocument();
  });

  it("C-61: a partner with no email shows the sentence-case sentinel, matching the detail page", async () => {
    renderPage();
    await screen.findByRole("link", { name: /quiet holdings/i });
    expect(screen.getByText("No email")).toBeInTheDocument();
    expect(screen.queryByText("no email")).not.toBeInTheDocument();
  });
});

// N3C-04/C-56 — the roster's edit state lives in `?edit=<id>`, so "edit this partner" is a
// link from anywhere (the partner detail page's "Edit partner" and its admin-notes empty
// state both point here) instead of an instruction to go and find a row's ⋯ menu.
describe("N3C-04/C-56: partners ?edit= deep link", () => {
  it("N3C-04/C-56: ?edit=<id> opens that partner's edit form once the roster loads", async () => {
    renderPage("p1");
    expect(await screen.findByRole("dialog", { name: /Edit PR-001/i })).toBeInTheDocument();
  });

  it("N3C-04/C-56: an id that matches no partner opens nothing — a stale link is not an error", async () => {
    renderPage("does-not-exist");
    await screen.findByRole("link", { name: /lone star buyers collective/i });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("N3C-04/C-56: no ?edit= leaves the roster closed, and the house row is not editable through it", async () => {
    renderPage(null);
    await screen.findByRole("link", { name: /lone star buyers collective/i });
    expect(screen.queryByRole("dialog")).toBeNull();
    // The house territory has its own dialog and is not part of the roster the link matches.
    renderPage("house");
    await screen.findAllByRole("link", { name: /lone star buyers collective/i });
    expect(screen.queryByRole("dialog", { name: /Edit HOUSE/i })).toBeNull();
  });

  it("N3C-04/C-56: closing the form drops ?edit= from the URL (replace, not push — no history spam)", async () => {
    const user = userEvent.setup();
    renderPage("p1");
    await screen.findByRole("dialog", { name: /Edit PR-001/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replace).toHaveBeenCalledWith("/partners", { scroll: false });
  });

  it("N3C-04/C-56: opening edit from the row menu writes ?edit=<id> into the URL", async () => {
    const user = userEvent.setup();
    renderPage(null);
    const row = (await screen.findByText("lone.star@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: /edit/i }));
    expect(replace).toHaveBeenCalledWith("/partners?edit=p1", { scroll: false });
  });
});
