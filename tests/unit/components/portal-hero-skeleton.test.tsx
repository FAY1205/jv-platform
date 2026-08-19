// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// N3A-01/C-51 (deep-UX audit 2026-08-19): the portal dashboard hero rendered its loading
// placeholder as `<Skeleton />` — a <div> — INSIDE a <p> (mobile headline) and an <h2>
// (desktop headline). A <div> is flow content and is invalid inside phrasing content, so
// the browser's parser relocates it and React reports a hydration mismatch (the single
// runtime error the audit's console sweep caught on this page).
//
// These tests pin the STRUCTURE, not the fix: any future edit that puts a <div> back inside
// a phrasing parent in this hero fails here regardless of how the placeholder is authored.

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  ApiError: class ApiError extends Error {},
}));
// The ~0.9 MB choropleth is code-split and irrelevant to the headline markup under test.
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));

import { PortalDashboard } from "@/app/portal/dashboard/portal-dashboard";

// useIsDesktop() -> window.matchMedia, which jsdom does not implement. `matches` is
// parameterised so BOTH breakpoint branches can be exercised: the mobile <p> headline and
// the desktop <h2> headline are both always in the DOM (CSS `display` hides one), but the
// hook also gates the map/preview siblings, so rendering at both values proves the sweep.
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  apiGet.mockReset();
  // Never resolves: the hero stays in its LOADING state, which is precisely the state that
  // renders the skeleton placeholders under test.
  apiGet.mockImplementation(() => new Promise(() => {}));
});

function renderHero() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalDashboard />
    </QueryClientProvider>,
  );
}

// Every HTML element whose content model is phrasing-only — a <div> inside any of these is
// invalid and triggers the parser relocation that causes the hydration mismatch.
const PHRASING_PARENTS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label", "a", "button"];
const DIV_IN_PHRASING = PHRASING_PARENTS.map((tag) => `${tag} div`).join(", ");

describe("portal dashboard hero — loading state markup validity", () => {
  it("N3A-01/C-51: portal hero skeleton is phrasing-safe (no div-in-p hydration mismatch)", () => {
    stubMatchMedia(false); // mobile: the <p> headline branch
    const { container } = renderHero();

    // The headline placeholders must actually be on screen — otherwise this test would
    // pass vacuously against an empty render.
    expect(container.querySelectorAll("p, h2").length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0);

    expect(container.querySelectorAll("p div")).toHaveLength(0);
    expect(container.querySelectorAll("h2 div")).toHaveLength(0);
    expect(container.querySelectorAll(DIV_IN_PHRASING)).toHaveLength(0);
  });

  it("N3A-01/C-51: the desktop hero headline is phrasing-safe too (h2 branch)", () => {
    stubMatchMedia(true); // desktop: the <h2> headline branch + map/preview siblings mount
    const { container } = renderHero();

    expect(container.querySelectorAll("h2").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(DIV_IN_PHRASING)).toHaveLength(0);
  });
});
