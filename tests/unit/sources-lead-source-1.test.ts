import { describe, expect, it } from "vitest";
import { applyProfile, detectProfile, LEAD_SOURCE_1_PROFILE, SEED_SOURCE_PROFILES } from "@/modules/sources";
import { getTransform, stripSkipTrace, transformLeadSource1 } from "@/modules/sources/transforms";
import { parseWorkbook } from "@/modules/sources/parse";
import { planRun } from "@/modules/run/plan";
import { buildCoverage } from "@/modules/pipeline/assign";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";

// ─────────────────────────────────────────────────────────────────────────────
// WP-LS1 — the "Lead Source 1" pure transform (PRN-01: same input ⇒ same output,
// no I/O, no Date.now()).
//
// ⚠️ SANITIZED (SEC-05): every name / phone / email / address here is INVENTED.
// The note-template STRUCTURE mirrors the real export; the PII does not.
// ─────────────────────────────────────────────────────────────────────────────

/** A vendor-A row (the `Listed?` / `Reason For Selling:` template). */
function vendorARow(over: Record<string, string> = {}): Record<string, string> {
  return {
    "Contact Name": "Dana Fake",
    phone: "(555) 555-0100",
    email: "dana@example.invalid",
    source: "Campaign Alpha",
    "Created on": "2026-07-07T17:30:37.714Z",
    "Property Address": "12 Invented St, Springfield IL 62704",
    Notes: [
      "Name: Dana Fake",
      "",
      "Listed? No",
      "",
      "Full Address: 12 Invented St, Springfield IL 62704",
      "",
      "Reason For Selling: Looking For a Quick Sale",
      "",
      "Skip Trace Emails: not.real@example.invalid; also.fake@example.invalid",
      "",
      "Skip Trace Phones: mobile, 5555550111; mobile, 5555550112 [DNC]",
      "",
      "MLS History / Days on Market:",
      "",
      "How Soon to Sell: ASAP",
    ].join("\n"),
    ...over,
  };
}

/** A vendor-B row (the `* Listed with realtor?:` / `* Sale urgency:` template). */
function vendorBRow(over: Record<string, string> = {}): Record<string, string> {
  return {
    "Contact Name": "Sam Pretend",
    phone: "5555550200",
    email: "sam@example.invalid",
    source: "Campaign Beta",
    "Created on": "2026-07-08T09:05:00.000Z",
    "Property Address": "9 Pretend Ave, Fakeville IL 60007",
    Notes: [
      "* Lead type: Seller",
      "* Listed with realtor?: No",
      "* Listed on MLS?:",
      "* Address: 9 Pretend Ave, Fakeville, Cook County, IL 60007",
      "* Reason for selling: Job relocation",
      "* Sale urgency: Within 30 days",
    ].join("\n"),
    ...over,
  };
}

const run = (row: Record<string, string>) =>
  transformLeadSource1(row, { notes: row.Notes, phone: row.phone, email: row.email });

describe("ING-03 LS1: Contact Name split", () => {
  it("ING-03: first token → sellerFirst, remainder → sellerLast", () => {
    const c = run(vendorARow({ "Contact Name": "Dana Fake" }));
    expect(c.sellerFirst).toBe("Dana");
    expect(c.sellerLast).toBe("Fake");
  });

  it("ING-03: a three-token name puts the remainder in sellerLast", () => {
    const c = run(vendorARow({ "Contact Name": "Ana Maria Invented" }));
    expect(c.sellerFirst).toBe("Ana");
    expect(c.sellerLast).toBe("Maria Invented");
  });

  it("ING-03: an odd two-people-in-one-field name stays readable, never throws", () => {
    // Structurally reproduces a real (sanitized) sample: "Paul. Lisa Hudson. Hudson".
    const c = run(vendorARow({ "Contact Name": "Rob. Jane Doe. Doe" }));
    expect(c.sellerFirst).toBe("Rob.");
    expect(c.sellerLast).toBe("Jane Doe. Doe");
  });

  it("ING-03: a single-token name leaves sellerLast blank", () => {
    const c = run(vendorARow({ "Contact Name": "Cher" }));
    expect(c.sellerFirst).toBe("Cher");
    expect(c.sellerLast).toBe("");
  });

  it("PRN-03 LS1: a blank name never throws and never drops the row", () => {
    const c = run(vendorARow({ "Contact Name": "" }));
    expect(c.sellerFirst).toBe("");
    expect(c.sellerLast).toBe("");
  });
});

describe("ING-03 LS1: Property Address decomposition", () => {
  it("ING-03: decomposes address / city / state / zip", () => {
    const c = run(vendorARow());
    expect(c.address).toBe("12 Invented St");
    expect(c.city).toBe("Springfield");
    expect(c.state).toBe("IL");
    expect(c.zip).toBe("62704");
  });

  it("ING-03: a multi-word city survives", () => {
    const c = run(vendorARow({ "Property Address": "5 Made Up Rd, Corpus Christi TX 78401" }));
    expect(c.city).toBe("Corpus Christi");
    expect(c.state).toBe("TX");
    expect(c.zip).toBe("78401");
  });

  it("NRM-01: a ZIP+4 keeps only the 5-digit ZIP", () => {
    const c = run(vendorARow({ "Property Address": "1 Fake Ln, Newark NJ 07102-1234" }));
    expect(c.zip).toBe("07102");
  });

  it("ING-03: falls back to the notes address line when Property Address is unusable", () => {
    const c = run(vendorARow({ "Property Address": "garbage with no structure" }));
    expect(c.address).toBe("12 Invented St");
    expect(c.city).toBe("Springfield");
    expect(c.state).toBe("IL");
    expect(c.zip).toBe("62704");
  });

  it("ING-03: falls back to the vendor-B '* Address:' line", () => {
    const c = run(vendorBRow({ "Property Address": "" }));
    expect(c.state).toBe("IL");
    expect(c.zip).toBe("60007");
  });

  it("PRN-03: both sources unusable → fields blank, row still ingests (→ Unmatched, never dropped)", () => {
    const c = run(vendorARow({ "Property Address": "", Notes: "Listed? No\n\nReason For Selling: n/a" }));
    expect(c.address).toBe("");
    expect(c.city).toBe("");
    expect(c.state).toBe("");
    expect(c.zip).toBe("");
  });
});

describe("ING-03 LS1: notes-template extraction (both vendor forms)", () => {
  it("ING-03: vendor-A reasonForSelling + timeToSell", () => {
    const c = run(vendorARow());
    expect(c.reasonForSelling).toBe("Looking For a Quick Sale");
    expect(c.timeToSell).toBe("ASAP");
  });

  it("ING-03: vendor-B reasonForSelling + timeToSell", () => {
    const c = run(vendorBRow());
    expect(c.reasonForSelling).toBe("Job relocation");
    expect(c.timeToSell).toBe("Within 30 days");
  });

  it("ING-03: motivation is blank — this export has no equivalent field", () => {
    expect(run(vendorARow()).motivation).toBe("");
    expect(run(vendorBRow()).motivation).toBe("");
  });

  it("ING-03: a missing template line yields blank, never throws", () => {
    const c = run(vendorARow({ Notes: "Listed? No" }));
    expect(c.reasonForSelling).toBe("");
    expect(c.timeToSell).toBe("");
  });
});

describe("SEC-05 LS1: skip-trace strip", () => {
  it("SEC-05: strips the skip-trace labels AND their values", () => {
    const notes = run(vendorARow()).notes ?? "";
    expect(notes).not.toContain("Skip Trace");
    expect(notes).not.toContain("not.real@example.invalid");
    expect(notes).not.toContain("5555550112");
    expect(notes).not.toContain("[DNC]");
  });

  it("SEC-05: KEEPS the listing question — the MLS filter runs on canonical notes", () => {
    expect(run(vendorARow()).notes).toContain("Listed? No");
  });

  it("SEC-05: keeps every non-skip-trace line", () => {
    const notes = run(vendorARow()).notes ?? "";
    expect(notes).toContain("Reason For Selling: Looking For a Quick Sale");
    expect(notes).toContain("How Soon to Sell: ASAP");
  });

  it("SEC-05: stripSkipTrace handles the vendor bullet prefix", () => {
    expect(stripSkipTrace("* Skip Trace Emails: a@b.invalid\n* Listed on MLS?: No")).toBe(
      "* Listed on MLS?: No",
    );
  });

  it("SEC-05: stripSkipTrace leaves notes without skip-trace untouched", () => {
    expect(stripSkipTrace("Listed? No\n\nReason For Selling: Moving")).toBe(
      "Listed? No\n\nReason For Selling: Moving",
    );
  });

  it("PRN-01: stripSkipTrace is deterministic", () => {
    const n = vendorARow().Notes;
    expect(stripSkipTrace(n)).toBe(stripSkipTrace(n));
  });
});

describe("ING-03 LS1: dateCreated", () => {
  it("ING-03: an ISO timestamp becomes a plain date", () => {
    expect(run(vendorARow()).dateCreated).toBe("2026-07-07");
  });

  it("PRN-01: the date is sliced, not parsed — no timezone can shift the day", () => {
    // 23:30Z would roll back a day in any negative-offset timezone if `new Date()`
    // were used. Determinism (PRN-01) requires the day to be host-independent.
    const c = run(vendorARow({ "Created on": "2026-07-07T23:30:00.000Z" }));
    expect(c.dateCreated).toBe("2026-07-07");
  });

  it("ING-03: an unparseable date passes through unchanged, never blanked", () => {
    const c = run(vendorARow({ "Created on": "last tuesday" }));
    expect(c.dateCreated).toBe("last tuesday");
  });
});

describe("SEAM: the transform registry", () => {
  it("SEAM: resolves a registered transform by name", () => {
    expect(getTransform("lead-source-1")).toBe(transformLeadSource1);
  });

  it("SEAM: an unknown transform name throws — a silent skip would ship raw leads", () => {
    expect(() => getTransform("does-not-exist")).toThrow(/unknown transform/i);
  });

  // `transform` is a free-text column. A plain object literal registry inherits
  // Object.prototype, so getTransform("constructor") would resolve to `Object` — a
  // callable — and applyProfile would invoke it, returning the RAW row as canonical:
  // no address, no name, and skip-trace values intact (SEC-05), with NO error raised.
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "SEAM: the inherited name %s throws — it must never resolve to a callable",
    (name) => {
      expect(() => getTransform(name)).toThrow(/unknown transform/i);
    },
  );

  it("SEC-05: a profile naming an inherited name cannot leak the raw row through applyProfile", () => {
    const row = vendorARow();
    expect(() => applyProfile(row, { ...LEAD_SOURCE_1_PROFILE, transform: "constructor" })).toThrow(
      /unknown transform/i,
    );
  });

  it("SEAM: applyProfile runs the profile's transform after column mapping", () => {
    const { canonical, raw } = applyProfile(vendorARow(), LEAD_SOURCE_1_PROFILE);
    // Direct mapping survives…
    expect(canonical.campaign).toBe("Campaign Alpha");
    expect(canonical.phone).toBe("(555) 555-0100");
    // …and the transform's derived fields are present.
    expect(canonical.sellerFirst).toBe("Dana");
    expect(canonical.city).toBe("Springfield");
    expect(canonical.notes).not.toContain("Skip Trace");
    // DM-02: the full original row is preserved, skip-trace and all.
    expect(String(raw.Notes)).toContain("Skip Trace Emails");
  });

  it("PRN-01: applyProfile is deterministic for the same row", () => {
    const row = vendorARow();
    expect(applyProfile(row, LEAD_SOURCE_1_PROFILE)).toEqual(applyProfile(row, LEAD_SOURCE_1_PROFILE));
  });
});

describe("ING-01 LS1: decoding is pinned to UTF-8, so a BOM cannot change the headers", () => {
  // The export's headers contain emoji ("⚠️ Dispo Key Notes"). Without a pinned codepage
  // SheetJS decodes a BOM-less CSV as Windows-1252 and a BOM'd one as UTF-8 — the SAME
  // logical export then yields two different header sets, so a signature matches one and
  // drifts 21 columns on the other, turning the ING-08 gate into noise. These cases drive
  // real BYTES (a signature-vs-itself check is tautological and cannot catch this).
  const csv = (rows: string) => `⚠️ Dispo Key Notes,Notes,phone\n${rows}`;
  const BOM = "﻿";

  it("ING-01: an emoji header decodes identically with and without a BOM", () => {
    const withoutBom = parseWorkbook(new TextEncoder().encode(csv("a,b,c")));
    const withBom = parseWorkbook(new TextEncoder().encode(BOM + csv("a,b,c")));
    expect(withoutBom.headers[0]).toBe("⚠️ Dispo Key Notes");
    expect(withBom.headers[0]).toBe("⚠️ Dispo Key Notes");
    expect(withBom.headers).toEqual(withoutBom.headers);
  });

  it("ING-01: no header is mojibake — the signature stores real text, not a decoder artifact", () => {
    // "â" / "Ã" / "ï¿" are the classic Latin-1-reading-UTF-8 signatures.
    const mojibake = LEAD_SOURCE_1_PROFILE.headerSignature.filter((h) => /â|Ã|ï¿/.test(h));
    expect(mojibake).toEqual([]);
  });
});

describe("ING-02/08 LS1: detection + drift on the consumed-column signature", () => {
  const SIGNATURE = LEAD_SOURCE_1_PROFILE.headerSignature;

  it("ING-02: the real export's headers detect as an exact match", () => {
    const r = detectProfile([...SIGNATURE], SEED_SOURCE_PROFILES);
    expect(r.status).toBe("exact");
    expect(r.profile?.name).toBe("Lead Source 1");
  });

  it("ING-07: a NEW CRM column is tolerated (flexible) — extras live on in raw_json", () => {
    const r = detectProfile([...SIGNATURE, "Some New CRM Column"], SEED_SOURCE_PROFILES);
    expect(r.status).toBe("exact");
  });

  it("ING-08: a RENAMED mapped column surfaces as drift — never silently re-guessed", () => {
    const mutated = SIGNATURE.map((h) => (h === "Property Address" ? "Property Addr" : h));
    const r = detectProfile(mutated, SEED_SOURCE_PROFILES);
    expect(r.status).toBe("drift");
    expect(r.diff?.removed).toContain("property address");
    expect(r.diff?.added).toContain("property addr");
  });

  it("ING-08: a REMOVED column surfaces as drift", () => {
    const r = detectProfile(SIGNATURE.filter((h) => h !== "Notes"), SEED_SOURCE_PROFILES);
    expect(r.status).toBe("drift");
    expect(r.diff?.removed).toContain("notes");
  });

  it("ING-02: an unrelated file does not masquerade as Lead Source 1", () => {
    expect(detectProfile(["Foo", "Bar", "Baz"], SEED_SOURCE_PROFILES).status).toBe("unknown");
  });
});

describe("DM-01 LS1: dedupe key on re-upload (ADR-0038: key stored for grouping, no collapse)", () => {
  const rules = { mlsPatterns: DEFAULT_MLS_PATTERNS, coverage: buildCoverage([], [{ state: "IL", partnerId: "partner-a" }]) };

  it("DM-01: the same property re-sent produces an identical dedupe key — and BOTH rows become leads", () => {
    const { leads } = planRun(
      [vendorARow(), vendorARow({ "Created on": "2026-07-09T10:00:00.000Z" })],
      LEAD_SOURCE_1_PROFILE,
      rules,
    );
    expect(leads).toHaveLength(2);
    expect(leads[0].dedupeKey).toBe(leads[1].dedupeKey);
    expect(leads[0].dedupeKey).toBe("12 invented st|62704");
    // ADR-0038: no history revert — each occurrence routes by the CURRENT coverage.
    expect(leads[1].partnerId).toBe("partner-a");
  });
});
