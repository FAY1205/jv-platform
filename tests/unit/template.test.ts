import { describe, expect, it } from "vitest";
import { templateRows } from "@/modules/sources/template";
import { GENERIC_PROFILE, INVESTORFUSE_PROFILE } from "@/modules/sources/seed-profiles";

// ING-05: a downloadable template rendered FROM a Source Profile — the exact
// expected headers + one example row so files are prepared correctly.
describe("templateRows", () => {
  it("ING-05: headers exactly match the profile's header signature", () => {
    const { headers } = templateRows(GENERIC_PROFILE);
    expect(headers).toEqual(GENERIC_PROFILE.headerSignature);
  });

  it("ING-05: the example row aligns to the headers and fills mapped columns", () => {
    const { headers, example } = templateRows(GENERIC_PROFILE);
    expect(example).toHaveLength(headers.length);
    // The column mapped to `zip` carries a sample ZIP.
    expect(example[headers.indexOf("Zip")]).toBe("75001");
    expect(example[headers.indexOf("State")]).toBe("TX");
  });

  it("ING-05: works for a real (InvestorFuse) profile too", () => {
    const { headers, example } = templateRows(INVESTORFUSE_PROFILE);
    expect(headers).toEqual(INVESTORFUSE_PROFILE.headerSignature);
    expect(example).toHaveLength(headers.length);
  });
});
