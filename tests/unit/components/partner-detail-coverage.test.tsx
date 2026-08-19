// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// N3A-04/C-49 (deep-UX audit 2026-08-19): the partner detail header hard-printed BOTH
// coverage segments unconditionally, so a state-only partner read "· 2 states · 0 ZIPs" —
// a zero that scans as a defect rather than as the ABSENCE of ZIP coverage. The header now
// routes through coverageSummary() (lib/coverage-summary.ts), the same helper the Partners
// roster uses. These tests pin the RENDERED header, so a future edit that re-inlines the
// counts fails here — coverage-summary.test.ts alone would still pass.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  ApiError: class ApiError extends Error {},
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "p1" }),
  usePathname: () => "/partners/p1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
// The ~0.9 MB choropleth and the lead dialog are code-split and irrelevant to the header.
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));

import PartnerDetailPage from "@/app/(admin)/partners/[id]/page";

const partner = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  refId: "PR-001",
  name: "Lone Star Buyers",
  email: "lone.star@example.com",
  phone: null,
  color: "amber",
  dealTerms: null,
  adminNotes: null,
  status: "active",
  zipCount: 0,
  stateCount: 2,
  territory: { states: [], zips: [] },
  ...over,
});

function mockPartner(over: Record<string, unknown> = {}) {
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.includes("/performance")) {
      return { range: { key: "30d", start: "", end: "", bucket: "day" }, stats: { given: 0, contacted: 0, closed: 0, avgContactHours: null }, history: [] };
    }
    if (url.includes("/leads")) return { leads: [] };
    if (url.includes("/api/coverage")) return { states: [], counties: [], partners: [], coveredCount: 0, zipCoverageCount: 0 };
    if (url.includes("/api/admin/partners/p1")) return { partner: partner(over) };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerDetailPage />
    </QueryClientProvider>,
  );
}

describe("partner detail header — coverage summary", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("N3A-04/C-49: a state-only partner shows the states, and NO '0 ZIPs' segment", async () => {
    mockPartner({ zipCount: 0, stateCount: 2 });
    renderDetail();

    expect(await screen.findByText("· 2 states")).toBeTruthy();
    // The regression itself: the absent coverage kind must not print as a zero.
    expect(screen.queryByText(/0 ZIPs/)).toBeNull();
  });

  it("N3A-04/C-49: a partner with both coverage kinds shows ZIPs then states", async () => {
    mockPartner({ zipCount: 14, stateCount: 3 });
    renderDetail();

    expect(await screen.findByText("· 14 ZIPs · 3 states")).toBeTruthy();
  });

  it("N3A-04/C-49: a partner with no coverage at all shows the em dash, not '0 states · 0 ZIPs'", async () => {
    mockPartner({ zipCount: 0, stateCount: 0 });
    renderDetail();

    expect(await screen.findByText("· —")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/0 (ZIPs?|states?)/)).toBeNull());
  });

  it("N3A-04/C-49: singular units are not pluralised (1 ZIP · 1 state)", async () => {
    mockPartner({ zipCount: 1, stateCount: 1 });
    renderDetail();

    expect(await screen.findByText("· 1 ZIP · 1 state")).toBeTruthy();
  });
});
