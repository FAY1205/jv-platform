import { describe, expect, it } from "vitest";
import { guardOutbound, sendEmail, MemoryTransport } from "@/modules/notify/email";

const sink = "sink@non-prod.test";
const realPartner = "randy@example.com";

// WP-002 / SEC-07: dev and preview must never email real recipients.
describe("SEC-07: outbound email guard", () => {
  it("redirects recipients to the sink in development", () => {
    const out = guardOutbound(
      { to: realPartner, subject: "New leads" },
      { appEnv: "development", sink },
    );
    expect(out.to).toEqual([sink]);
    expect(out.intendedTo).toEqual([realPartner]);
    expect(out.redirected).toBe(true);
  });

  it("redirects recipients to the sink in preview", () => {
    const out = guardOutbound(
      { to: [realPartner, "josh@example.com"], subject: "Digest" },
      { appEnv: "preview", sink },
    );
    expect(out.to).toEqual([sink]);
    expect(out.intendedTo).toEqual([realPartner, "josh@example.com"]);
    expect(out.redirected).toBe(true);
  });

  it("passes recipients through untouched in production", () => {
    const out = guardOutbound(
      { to: [realPartner], subject: "Digest" },
      { appEnv: "production", sink },
    );
    expect(out.to).toEqual([realPartner]);
    expect(out.intendedTo).toEqual([realPartner]);
    expect(out.redirected).toBe(false);
  });

  it("sendEmail never hands a real recipient to the transport in non-prod", async () => {
    const transport = new MemoryTransport();
    const res = await sendEmail(
      { to: realPartner, subject: "New leads" },
      transport,
      { appEnv: "development", sink },
    );
    expect(res.redirected).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toEqual([sink]);
    expect(transport.sent[0].to).not.toContain(realPartner);
  });
});
