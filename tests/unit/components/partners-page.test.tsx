// @vitest-environment jsdom
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({
  usePathname: () => "/partners",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));

import PartnersPage from "@/app/(admin)/partners/page";

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
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.includes("/api/admin/partners")) {
      return {
        partners: [
          partner(),
          partner({ id: "house", refId: "HOUSE", name: "My Territory", isHouse: true, zipCount: 0, stateCount: 3 }),
        ],
      };
    }
    if (url.includes("/api/coverage")) return { states: [], counties: [], partners: [], coveredCount: 0 };
    if (url.includes("/count")) return { count: 0 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PartnersPage />
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
});
