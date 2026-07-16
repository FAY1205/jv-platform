import { describe, it, expect, vi, afterEach } from "vitest";
import { ResendTransport } from "@/modules/notify/resend";
import type { OutboundEmail } from "@/modules/notify/email";

// SEC-05 + ADR-0032: a Resend send failure now flows through logError → Sentry (a third
// party). Resend's response body can echo the recipient's email address, so the thrown
// error must carry the status code ONLY — never the response body.
const msg: OutboundEmail = {
  to: ["partner@real.test"],
  intendedTo: ["partner@real.test"],
  redirected: false,
  subject: "Your sign-in code",
  text: "code 481920",
};

afterEach(() => vi.unstubAllGlobals());

describe("SEC-05: ResendTransport error redaction", () => {
  it("throws with the status code only — never Resend's response body (which can echo the recipient)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "The recipient partner@real.test is not a verified test address",
      })),
    );
    const t = new ResendTransport("re_key", "from@jv.test");

    let caught: Error | undefined;
    try {
      await t.send(msg);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("Resend send failed (403)"); // status only
    expect(caught?.message).not.toContain("partner@real.test"); // recipient never rides along
  });
});
