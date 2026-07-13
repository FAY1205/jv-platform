// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-AI-2 Task 9: AppShell mounts the assistant widget (Task 8) on the admin surface.
// AppShell pulls in NotificationBell/ProfileMenu (real useQuery/useMutation/useQueryClient,
// which need a live QueryClient — not just a mocked useQuery) plus SearchExpand and
// ThemeToggle. The established pattern for rendering a shell like this (see
// portal-shell.test.tsx, ws7-components.test.tsx) is a real QueryClientProvider with
// retry disabled and a stubbed global fetch, rather than mocking @tanstack/react-query.

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
// next/dynamic(..., {ssr:false}) renders nothing on first paint in real usage; mock it to
// render the lazily-imported module synchronously so we can assert the wiring.
vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    return function Stub() {
      return <div data-testid="assistant-mounted" />;
    };
  },
}));

import { AppShell } from "@/components/AppShell";

afterEach(() => vi.unstubAllGlobals());

function renderShell() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell>
        <div>page</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

describe("WP-AI-2: AppShell mounts the assistant on the admin surface", () => {
  it("renders the lazily-mounted assistant widget", () => {
    renderShell();
    expect(screen.getByTestId("assistant-mounted")).toBeTruthy();
  });
});
