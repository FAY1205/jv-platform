// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn() }));

// jsdom lacks ResizeObserver; some primitives observe size. Stub so mount is safe.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { PartnerForm } from "@/app/(admin)/partners/page";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe("WP-C PartnerForm — create", () => {
  it("blocks submit and shows field errors when name/email are empty (email now required)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    wrap(<PartnerForm editing={null} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /create partner/i }));

    expect(await screen.findByText(/name is required/i)).toBeTruthy();
    expect(screen.getByText(/email is required/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled(); // never hit the server with invalid input
    expect(onClose).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("toggles the coverage editor between the state multi-select and the ZIP textarea", async () => {
    const user = userEvent.setup();
    wrap(<PartnerForm editing={null} onClose={vi.fn()} />);

    // Defaults to the searchable state picker (no free-text state box).
    expect(screen.getByRole("combobox", { name: /add covered states/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^zip codes$/i }));
    expect(screen.getByLabelText(/covered zip codes/i)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /add covered states/i })).toBeNull();
  });

  it("flags an invalid ZIP token inline and blocks submit", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    wrap(<PartnerForm editing={null} onClose={vi.fn()} />);

    // Fill the required contact fields so only the ZIP is invalid.
    await user.type(screen.getByLabelText(/^name/i), "Acme");
    await user.type(screen.getByLabelText(/^email/i), "a@b.co");
    await user.click(screen.getByRole("button", { name: /^zip codes$/i }));
    await user.type(screen.getByLabelText(/covered zip codes/i), "75001, AB");

    expect(await screen.findByText(/aren't valid zips: AB/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /create partner/i }));
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
