import { describe, expect, it } from "vitest";
import { rowToEmailMessage } from "@/modules/notify/outbox";

describe("rowToEmailMessage (NTF-03 drain mapping)", () => {
  const base = { toAddress: "p@x.test", subject: "S", body: "text body", kind: "partner_digest" };
  it("includes html when the row has it (multipart)", () => {
    const m = rowToEmailMessage({ ...base, html: "<p>hi</p>" });
    expect(m).toMatchObject({ to: "p@x.test", subject: "S", text: "text body", html: "<p>hi</p>", meta: { kind: "partner_digest" } });
  });
  it("omits html when null (text-only, backward-compatible)", () => {
    expect(rowToEmailMessage({ ...base, html: null }).html).toBeUndefined();
  });
});
