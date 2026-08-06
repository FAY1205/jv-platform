// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fmtDate, fmtDateTime, fmtBucket } from "@/lib/dates";

// VCF-2.5 / audit F-5: one date-format surface. Locale is pinned to en-US once, so the
// same server timestamp renders identically on every admin and portal surface (the bug was
// admin Imports showing "Jul 10, 2026" while the portal showed "7/10/2026"). Shape is
// asserted (not a TZ-dependent exact day) since fmtDate/fmtDateTime use the viewer's local
// time zone; fmtBucket pins UTC and IS exact.
describe("VCF-2.5: shared date formatters", () => {
  const iso = "2026-07-10T15:04:00Z";

  it("DATES-01: fmtDate renders the pinned 'MMM D, YYYY' form, never the numeric locale form", () => {
    const out = fmtDate(iso);
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/); // e.g. "Jul 10, 2026"
    expect(out).not.toContain("/"); // never "7/10/2026" — the portal's old viewer-locale form
    expect(out).toContain("2026");
  });

  it("DATES-02: fmtDateTime renders 'MMM D, YYYY, h:mm AM/PM'", () => {
    // \s covers the narrow no-break space (U+202F) newer ICU inserts before AM/PM.
    expect(fmtDateTime(iso)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s*(?:AM|PM)$/);
  });

  it("DATES-03: fmtBucket pins UTC so day/month buckets align to server boundaries", () => {
    expect(fmtBucket("2026-07-03", "day")).toBe("Jul 3");
    expect(fmtBucket("2026-07-01", "month")).toBe("Jul 2026");
    // A bucketStart at UTC midnight must not slip to the previous day for a west-of-UTC viewer.
    expect(fmtBucket("2026-07-03T00:00:00Z", "day")).toBe("Jul 3");
  });
});
