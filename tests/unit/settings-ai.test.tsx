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

  const noCred = { configured: false, provider: null, model: null, encryptionAvailable: false };

  it("SET-11: OFF hides the provider section; no usage estimate is shown (ADR-0036)", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: false }, credential: { configured: false, provider: null, model: null, encryptionAvailable: true } });
    wrap(<AiSettings />);
    await screen.findByRole("switch");
    // Provider/key section is revealed only when the assistant is on — the API key
    // field (which only exists inside that section) is absent while OFF.
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    // Removed for BYO: no allowance input and no usage-estimate readout.
    expect(screen.queryByLabelText(/allowance/i)).toBeNull();
    expect(screen.queryByText(/usage this month/i)).toBeNull();
  });

  it("SET-11: toggling the switch auto-saves enabled and reveals the provider section", async () => {
    // Initial GET is OFF; after the toggle persists, the re-fetch reflects the saved ON state.
    apiGet
      .mockResolvedValueOnce({ settings: { enabled: false }, credential: { configured: false, provider: null, model: null, encryptionAvailable: true } })
      .mockResolvedValue({ settings: { enabled: true }, credential: { configured: false, provider: null, model: null, encryptionAvailable: true } });
    apiMutate.mockResolvedValue({ settings: { enabled: true } });
    wrap(<AiSettings />);
    await userEvent.click(await screen.findByRole("switch"));
    // No separate "Save changes" button — the toggle itself persists.
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/settings/ai", "PUT", { enabled: true }));
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(await screen.findByLabelText(/api key/i)).toBeTruthy();
  });

  it("ADR-0036: with a key saved, Test connection POSTs {action:test} and shows the result", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: true }, credential: { configured: true, provider: "google", model: null, encryptionAvailable: true } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "ok", test: { ok: false, reason: "provider", message: "The provider rejected the key." } }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      wrap(<AiSettings />);
      await userEvent.click(await screen.findByRole("button", { name: /test connection/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "test" });
      expect(await screen.findByText(/provider rejected the key/i)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ADR-0036: with the assistant on, saving a key POSTs {action:set, provider, apiKey}; the key is never read back from GET", async () => {
    // GET never carries the key — only a status object. Prove the write goes out as a
    // separate POST with the plaintext key in the body (the default provider is google).
    apiGet.mockResolvedValue({ settings: { enabled: true }, credential: { configured: false, provider: null, model: null, encryptionAvailable: true } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "ok", credential: { configured: true, provider: "google", model: null, encryptionAvailable: true } }) });
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
      // The set payload now also carries the chosen model (default = Google's top tier).
      expect(JSON.parse(opts.body)).toEqual({ action: "set", provider: "google", apiKey: "sk-test-abcdefgh", model: "gemini-3.6-flash" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
