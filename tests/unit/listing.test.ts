import { describe, expect, it } from "vitest";
import { LinkOnlyProvider } from "@/modules/listing/link-only";

// LST-02/03: the LinkOnly provider is a labeled heuristic — it never determines
// yes/no automatically; it returns "unknown" plus a link to verify manually, and
// it NEVER removes a lead (that's the caller's contract, PRN-09).
describe("LinkOnlyProvider", () => {
  const p = new LinkOnlyProvider();

  it("LST-02: identifies itself and returns status unknown with a verify link", () => {
    const r = p.check({ address: "123 Main St", city: "Dallas", state: "TX", zip: "75001" });
    expect(r.provider).toBe("link_only");
    expect(r.status).toBe("unknown");
    expect(r.link).toContain("123%20Main%20St");
    expect(r.link).toContain("Dallas");
  });

  it("LST-03: with no address at all, there is no link (nothing to search)", () => {
    const r = p.check({ address: null, city: null, state: null, zip: null });
    expect(r.status).toBe("unknown");
    expect(r.link).toBeUndefined();
  });
});
