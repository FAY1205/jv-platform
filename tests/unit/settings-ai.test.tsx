// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";

const apiGet = vi.fn();
const apiMutate = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a), apiMutate: (...a: unknown[]) => apiMutate(...a), ApiError: class {} }));

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

  it("SET-11: shows the enable switch, cap and month-to-date usage in $", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: true, capUsd: 10 }, usage: { spentMicroUsd: 3_450_000, spentUsd: 0.35 } });
    wrap(<AiSettings />);
    expect(await screen.findByText(/\$0\.35/)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("BIL-04: saving PUTs the enabled + cap values", async () => {
    apiGet.mockResolvedValue({ settings: { enabled: false, capUsd: 10 }, usage: { spentMicroUsd: 0, spentUsd: 0 } });
    apiMutate.mockResolvedValue({ settings: { enabled: true, capUsd: 25 } });
    wrap(<AiSettings />);
    await screen.findByRole("switch");
    await userEvent.click(screen.getByRole("switch"));
    const cap = screen.getByLabelText(/monthly allowance/i);
    await userEvent.clear(cap);
    await userEvent.type(cap, "25");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith("/api/settings/ai", "PUT", { enabled: true, capUsd: 25 }));
  });
});
