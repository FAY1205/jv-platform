import { describe, expect, it } from "vitest";
import { suggestMapping, missingRequiredFor, buildConfirmedProfile } from "@/modules/sources/mapping";
import { GENERIC_PROFILE } from "@/modules/sources/seed-profiles";
import { CANONICAL_FIELDS } from "@/modules/sources/types";

// ING-02/08: when a format drifts or is new, propose a mapping (best guess) and let
// the admin confirm it into a new/next profile version. PURE.
const genericHeaders = GENERIC_PROFILE.headerSignature;

describe("suggestMapping", () => {
  it("ING-08: keeps unchanged columns and follows a rename", () => {
    // "Zip" was renamed to "Zip Code" in the uploaded file.
    const uploaded = genericHeaders.map((h) => (h === "Zip" ? "Zip Code" : h));
    const m = suggestMapping(GENERIC_PROFILE, uploaded);
    expect(m.city).toBe("City"); // unchanged
    expect(m.zip).toBe("Zip Code"); // followed the rename
  });

  it("ING-02: for an unknown file, auto-maps columns whose header matches a canonical name", () => {
    const m = suggestMapping(null, ["Zip", "State", "Mystery Column"]);
    expect(m.zip).toBe("Zip");
    expect(m.state).toBe("State");
  });
});

describe("missingRequiredFor", () => {
  it("ING-08: flags a required field with no mapped source column", () => {
    const mapping = { state: "State" };
    const missing = missingRequiredFor(mapping, ["zip", "state"], ["State", "City"]);
    expect(missing).toEqual(["zip"]);
  });

  it("ING-08: a mapped column that isn't in the file is still missing", () => {
    const missing = missingRequiredFor({ zip: "Gone" }, ["zip"], ["City"]);
    expect(missing).toEqual(["zip"]);
  });
});

describe("buildConfirmedProfile", () => {
  it("ING-08/DM-08: drift confirm bumps the version and keeps the id/name", () => {
    const p = buildConfirmedProfile({
      base: GENERIC_PROFILE,
      name: GENERIC_PROFILE.name,
      uploadHeaders: ["Campaign", "Zip Code"],
      mapping: { campaign: "Campaign", zip: "Zip Code" },
      strictness: "flexible",
    });
    expect(p.version).toBe(GENERIC_PROFILE.version + 1);
    expect(p.name).toBe("Generic");
    expect(p.headerSignature).toEqual(["Campaign", "Zip Code"]);
    expect(p.mapping.zip).toBe("Zip Code");
  });

  it("ING-02: a brand-new format starts at version 1", () => {
    const p = buildConfirmedProfile({
      base: null,
      name: "Acme CRM",
      uploadHeaders: ["Zip", "State"],
      mapping: { zip: "Zip", state: "State" },
      strictness: "flexible",
    });
    expect(p.version).toBe(1);
    expect(p.name).toBe("Acme CRM");
    // Only canonical fields the mapping references are kept.
    expect(Object.keys(p.mapping).every((k) => CANONICAL_FIELDS.includes(k as never))).toBe(true);
  });
});
