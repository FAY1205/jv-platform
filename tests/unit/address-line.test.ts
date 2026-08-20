import { describe, expect, it } from "vitest";
import { addressLine } from "@/lib/address-line";

// N5E-06: the record panel's combined address line. Pure, and shared by the admin record and
// its portal twin — the two must never render the same lead's address differently.

describe("N5E-06: addressLine", () => {
  it("N5E-06: joins the four columns the way an address is read", () => {
    expect(addressLine(["20443 Fleetwood Dr", "Harper Woods", "MI", "48225"])).toBe(
      "20443 Fleetwood Dr, Harper Woods, MI 48225",
    );
  });

  it("N5E-06: state and ZIP are ONE segment — 'MI, 48225' would read as two places", () => {
    expect(addressLine(["1 Main St", "Tulsa", "OK", "74105"])).toContain("OK 74105");
  });

  it("N5E-06: a missing part drops out with its separator, never leaving a stray comma", () => {
    expect(addressLine(["", "Harper Woods", "MI", "48225"])).toBe("Harper Woods, MI 48225");
    expect(addressLine(["20443 Fleetwood Dr", "", "", "48225"])).toBe("20443 Fleetwood Dr, 48225");
    expect(addressLine(["20443 Fleetwood Dr", "Harper Woods", "", ""])).toBe("20443 Fleetwood Dr, Harper Woods");
  });

  it("N5E-06: all-empty is the empty string — the caller demotes it to 'Not provided'", () => {
    expect(addressLine(["", "", "", ""])).toBe("");
    expect(addressLine([null, undefined, "  ", ""])).toBe("");
  });

  it("N5E-06: whitespace-only parts are dropped, not rendered as gaps", () => {
    expect(addressLine([" 1 Main St ", "  ", "OK", " 74105 "])).toBe("1 Main St, OK 74105");
  });
});
