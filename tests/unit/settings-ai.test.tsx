// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

const apiGet = vi.fn();
const apiMutate = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a), apiMutate: (...a: unknown[]) => apiMutate(...a), ApiError: class {} }));
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

import { AiSettings } from "@/app/settings/ai/ai-settings";

// AiSettings calls useToast() unconditionally (per BIL-04's onSuccess/onError), so the
// harness needs a real <ToastProvider> the same way tests/unit/components/leads-components.test.tsx does.
function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe("WP-AI-2 AiSettings", () => {
  beforeEach(() => { apiGet.mockReset(); apiMutate.mockReset(); });

  const noCred = { configured: false, provider: null, encryptionAvailable: false };

  it("SET-11: shows the enable switch and read-only month-to-date usage estimate", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: true }, credential: noCred, usage: { spentMicroUsd: 3_450_000, spentUsd: 0.35 } });
    wrap(<AiSettings />);
    expect(await screen.findByText(/\$0\.35/)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
    // The removed spend cap: no allowance input is rendered (ADR-0036).
    expect(screen.queryByLabelText(/allowance/i)).toBeNull();
  });

  it("BIL-04: saving PUTs only the enabled flag (cap removed, ADR-0036)", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: false }, credential: noCred, usage: { spentMicroUsd: 0, spentUsd: 0 } });
    apiMutate.mockResolvedValue({ settings: { enabled: true } });
    wrap(<AiSettings />);
    await screen.findByRole("switch");
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/settings/ai", "PUT", { enabled: true }));
  });

  it("ADR-0036: saving a provider key POSTs {action:set, provider, apiKey}; the key is never read back from GET", async () => {
    // GET never carries the key — only a status object. Prove the write goes out as a
    // separate POST with the plaintext key in the body (the default provider is google).
    apiGet.mockResolvedValue({ settings: { enabled: false }, credential: { configured: false, provider: null, encryptionAvailable: true }, usage: { spentMicroUsd: 0, spentUsd: 0 } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "ok", credential: { configured: true, provider: "google", encryptionAvailable: true } }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      wrap(<AiSettings />);
      const key = await screen.findByLabelText(/api key/i);
      await userEvent.type(key, "sk-test-abcdefgh");
      await userEvent.click(screen.getByRole("button", { name: /save key/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/settings/ai");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ action: "set", provider: "google", apiKey: "sk-test-abcdefgh" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
