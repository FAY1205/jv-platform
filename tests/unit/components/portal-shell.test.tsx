// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockPath = "/portal/leads";
// T7a: the shell now also fetches the Leads nav-badge count — the mock routes by URL
// (count 0 by default so the badge stays hidden and the pre-T7a assertions hold).
let mockCount: { count: number } = { count: 0 };
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) =>
    url.includes("/api/portal/leads/count")
      ? mockCount
      : { email: "ops@meridianbuyers.com", role: "partner", workspace: { name: "Meridian Buyers" } }),
}));

import { PortalShell, useToast } from "@/components";

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalShell>
        <p>page body</p>
      </PortalShell>
    </QueryClientProvider>,
  );
}

// WP-PW-1 note: at md+ the shell renders BOTH a desktop rail nav and the mobile bottom-tab
// nav (each labeled "Portal") in one single-render tree — jsdom applies no compiled Tailwind
// CSS, so `md:hidden` / `hidden md:flex` don't actually hide either. Assertions below use
// getAllByRole and check every match rather than assuming a single landmark/link.
describe("PortalShell", () => {
  it("F-66: renders the four bottom tabs as a labeled nav", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getAllByRole("navigation", { name: "Portal" }).length).toBeGreaterThan(0);
    for (const [name, href] of [
      ["Dashboard", "/portal/dashboard"],
      ["Leads", "/portal/leads"],
      ["Activity", "/portal/activity"],
      ["Account", "/portal"],
    ] as const) {
      const links = screen.getAllByRole("link", { name });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", href);
    }
  });

  it("WP-F.3: marks the Dashboard tab current on /portal/dashboard", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    for (const link of screen.getAllByRole("link", { name: "Dashboard" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Leads" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("marks the active tab from the URL", () => {
    mockPath = "/portal/leads";
    renderShell();
    for (const link of screen.getAllByRole("link", { name: "Leads" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Activity" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("hides the shell chrome on the pre-auth login route", () => {
    mockPath = "/portal/login";
    renderShell();
    expect(screen.queryByRole("navigation", { name: "Portal" })).toBeNull();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("P-3: mounts a ToastProvider — a child calling useToast() renders (no admin/portal drift)", () => {
    mockPath = "/portal/leads";
    function ToastChild() {
      useToast(); // throws "must be used within <ToastProvider>" if the shell doesn't mount one
      return <p>toast ok</p>;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PortalShell><ToastChild /></PortalShell>
      </QueryClientProvider>,
    );
    expect(screen.getByText("toast ok")).toBeInTheDocument();
  });
});

// T7a (owner testing round 1, note #10): the desktop chrome is the admin AppShell,
// portal-flavored — brand descriptor, live Leads badge, collapse toggle, ProfileMenu foot.
describe("PortalShell T7a admin parity", () => {
  afterEach(() => {
    mockCount = { count: 0 };
  });

  it("T7a: the rail brand carries the 'Partner portal' descriptor", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getByText("Partner portal")).toBeInTheDocument();
  });

  it("T7a/D2: the Leads rail item carries the count in ITS accessible name ('Leads, 412'), badge aria-hidden", async () => {
    mockPath = "/portal/dashboard";
    mockCount = { count: 412 };
    renderShell();
    // D2 accname polish: the count composes into the link name, not a badge label.
    const rail = await screen.findByRole("link", { name: "Leads, 412" });
    expect(rail).toHaveAttribute("href", "/portal/leads");
    // The mobile tab (no badge) keeps the plain name.
    expect(screen.getAllByRole("link", { name: "Leads" })).toHaveLength(1);
  });

  it("T7a: a zero count renders no badge and leaves the plain link name", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.queryByRole("link", { name: /Leads, \d/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Leads" }).length).toBeGreaterThan(0);
  });

  it("T7a: the desktop top bar has the rail collapse toggle (admin pattern)", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("T7a: the rail foot is the account menu (ProfileMenu pattern), not a bare link", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.queryByText("View account")).toBeNull();
  });

  it("T7a: 'Account' is a mobile tab only — the desktop rail leaves it to the foot menu (owner call)", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    // jsdom renders both navs (no compiled CSS): rail + tabs each contribute a link for
    // the three rail sections (2 each), but Account appears ONLY in the mobile tab bar.
    expect(screen.getAllByRole("link", { name: "Account" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Dashboard" })).toHaveLength(2);
  });
});
