import { describe, it, expect } from "vitest";
import { resolveEmailTransport } from "@/modules/notify/transport";
import { DevMailboxTransport } from "@/modules/notify/dev-mailbox";
import { ResendTransport } from "@/modules/notify/resend";

// NTF-03 / SEC-07: one place decides "when do we send email for real". Both the instant
// path (auth OTP/invite/reset) and the batched outbox delegate here, so they cannot
// drift. Pure and injectable on purpose — the thing it guards (no real email off
// production) is exactly what must be unit-testable without process-env gymnastics.
const FROM = "JV Platform <noreply@example.test>";

describe("NTF-03 / SEC-07: email transport resolution", () => {
  it("SEC-07: non-production returns the dev mailbox EVEN WITH a Resend key set", () => {
    // The core guarantee: dev/preview can never reach a real recipient, key or no key.
    const t = resolveEmailTransport({ isProduction: false, resendKey: "re_live_key", emailFrom: FROM });
    expect(t).toBeInstanceOf(DevMailboxTransport);
  });

  it("NTF-03: production WITH a key returns the Resend transport", () => {
    const t = resolveEmailTransport({ isProduction: true, resendKey: "re_live_key", emailFrom: FROM });
    expect(t).toBeInstanceOf(ResendTransport);
  });

  it("NTF-03: production WITHOUT a key falls back to the dev mailbox (never a broken send)", () => {
    const t = resolveEmailTransport({ isProduction: true, resendKey: undefined, emailFrom: FROM });
    expect(t).toBeInstanceOf(DevMailboxTransport);
  });
});
