// ─────────────────────────────────────────────────────────────────────────────
// TST-05 — a sanitized "Lead Source 1" week (WP-LS1). The golden gate's input.
//
// ⚠️ SANITIZED (SEC-05). Every name, phone, email and street address below is
// INVENTED. The STRUCTURE is faithful to the real 179-column CRM export — the two
// vendor note-templates, the skip-trace block, the "MLS History / Days on Market:"
// label, the `Property Address` shape, ISO `Created on` — but no real seller PII
// from the sample files is present, and none may ever be pasted in here.
//
// Only the columns the profile reads are included; the export's other ~170 columns
// are CRM scaffolding that the flexible profile tolerates and raw_json preserves.
// The row mix deliberately covers every decision branch the pipeline can take —
// see the `why` on each row.
//
// States are chosen against tests/fixtures/sample-coverage.ts so the week exercises
// zip-override, state-fallback, and an uncovered (Unmatched) lead.
// ─────────────────────────────────────────────────────────────────────────────

interface Row {
  "Contact Name": string;
  phone: string;
  email: string;
  source: string;
  "Created on": string;
  "Property Address": string;
  Notes: string;
}

/** Vendor-A notes template (`Listed?` + `Reason For Selling:` + skip-trace block). */
function vendorANotes(opts: {
  listed: string;
  reason: string;
  urgency: string;
  fullAddress?: string;
  skipTrace?: boolean;
}): string {
  return [
    `Listed? ${opts.listed}`,
    "",
    opts.fullAddress ? `Full Address: ${opts.fullAddress}` : "",
    "",
    `Reason For Selling: ${opts.reason}`,
    "",
    // The label that the retired v1 `on market` pattern false-fired on (57% of rows).
    "MLS History / Days on Market:",
    "",
    ...(opts.skipTrace
      ? [
          "Skip Trace Emails: not.real@example.invalid; also.fake@example.invalid",
          "",
          "Skip Trace Phones: mobile, 5555550111; mobile, 5555550112 [DNC]",
          "",
        ]
      : []),
    `How Soon to Sell: ${opts.urgency}`,
  ].join("\n");
}

/** Vendor-B notes template (`* Listed with realtor?:` + `* Sale urgency:`). */
function vendorBNotes(opts: {
  realtor: string;
  mls: string;
  reason: string;
  urgency: string;
  address?: string;
}): string {
  return [
    "* Lead type: Seller",
    `* Listed with realtor?: ${opts.realtor}`,
    `* Listed on MLS?: ${opts.mls}`,
    opts.address ? `* Address: ${opts.address}` : "",
    `* Reason for selling: ${opts.reason}`,
    `* Sale urgency: ${opts.urgency}`,
  ].join("\n");
}

export interface WeekRow {
  row: Row;
  why: string;
}

export const LEAD_SOURCE_1_WEEK: readonly WeekRow[] = [
  {
    why: "vendor-A Listed? Yes ⇒ removed (the dominant real form, 112/182 rows)",
    row: {
      "Contact Name": "Dana Fake",
      phone: "(555) 555-0100",
      email: "dana@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-07T17:30:37.714Z",
      "Property Address": "12 Invented St, Houston TX 77021",
      Notes: vendorANotes({ listed: "Yes", reason: "Looking For a Quick Sale", urgency: "ASAP", skipTrace: true }),
    },
  },
  {
    why: "vendor-A Listed? No + the 'Days on Market:' label ⇒ kept, zip 77021 OVERRIDES the TX fallback (ASN-01)",
    row: {
      "Contact Name": "Rory Notreal",
      phone: "555-555-0101",
      email: "rory@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-07T18:02:11.000Z",
      "Property Address": "48 Pretend Blvd, Houston TX 77021",
      Notes: vendorANotes({ listed: "No", reason: "Relocating", urgency: "3-6 months", skipTrace: true }),
    },
  },
  {
    why: "vendor-A kept ⇒ state fallback (CA), and a 3-token name exercises the first/rest split",
    row: {
      "Contact Name": "Ana Maria Invented",
      phone: "5555550102",
      email: "ana@example.invalid",
      source: "Campaign Beta",
      "Created on": "2026-07-08T09:14:52.500Z",
      "Property Address": "7 Imaginary Way, Sacramento CA 95814",
      Notes: vendorANotes({ listed: "No", reason: "Inherited the property", urgency: "Flexible" }),
    },
  },
  {
    why: "zip 90815 OVERRIDES the CA fallback (ASN-01 zip precedence beats state)",
    row: {
      "Contact Name": "Kit Madeup",
      phone: "5555550103",
      email: "kit@example.invalid",
      source: "Campaign Beta",
      "Created on": "2026-07-08T11:00:00.000Z",
      "Property Address": "310 Fictional Ave, Long Beach CA 90815",
      Notes: vendorANotes({ listed: "No", reason: "Downsizing", urgency: "ASAP" }),
    },
  },
  {
    why: "vendor-B realtor No + MLS blank ⇒ kept (the dominant vendor-B form, 69/182 rows)",
    row: {
      "Contact Name": "Sam Pretend",
      phone: "5555550200",
      email: "sam@example.invalid",
      source: "Campaign Gamma",
      "Created on": "2026-07-08T13:20:05.000Z",
      "Property Address": "9 Pretend Ave, Phoenix AZ 85004",
      Notes: vendorBNotes({ realtor: "No", mls: "", reason: "Job relocation", urgency: "Within 30 days" }),
    },
  },
  {
    why: "vendor-B Listed on MLS?: Yes ⇒ removed (defensive: no live sample coverage)",
    row: {
      "Contact Name": "Blair Invented",
      phone: "5555550201",
      email: "blair@example.invalid",
      source: "Campaign Gamma",
      "Created on": "2026-07-09T08:45:00.000Z",
      "Property Address": "22 Nonexistent Rd, Seattle WA 98101",
      Notes: vendorBNotes({ realtor: "No", mls: "Yes", reason: "Upsizing", urgency: "ASAP" }),
    },
  },
  {
    why: "archived 'Is it Listed? : True' block inside a Lead Source 1 export ⇒ removed",
    row: {
      "Contact Name": "Jo Fabricated",
      phone: "5555550104",
      email: "jo@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-09T10:30:00.000Z",
      "Property Address": "5 Unreal Ct, Denver CO 80202",
      Notes: "Is it Listed? : True If Yes, MLS Date Active :\n\nReason For Selling: Testing the archived form\n\nHow Soon to Sell: ASAP",
    },
  },
  {
    why: "UNMATCHED (PRN-03): Michigan has no coverage ⇒ ingests with no partner",
    row: {
      "Contact Name": "Alex Phony",
      phone: "5555550105",
      email: "alex@example.invalid",
      source: "Campaign Beta",
      "Created on": "2026-07-09T15:05:00.000Z",
      "Property Address": "100 Fake Row, Detroit MI 48205",
      Notes: vendorANotes({ listed: "No", reason: "Tired landlord", urgency: "6+ months" }),
    },
  },
  {
    why: "PRN-03: Property Address unusable ⇒ the notes 'Full Address:' fallback recovers the territory",
    row: {
      "Contact Name": "Sky Bogus",
      phone: "5555550106",
      email: "sky@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-10T09:00:00.000Z",
      "Property Address": "address unavailable",
      Notes: vendorANotes({
        listed: "No",
        reason: "Probate sale",
        urgency: "Flexible",
        fullAddress: "88 Recovered St, Portland OR 97205",
      }),
    },
  },
  {
    why: "PRN-03: BOTH address sources unusable ⇒ blank territory, still ingests → Unmatched, never dropped",
    row: {
      "Contact Name": "Cher",
      phone: "5555550107",
      email: "cher@example.invalid",
      source: "Campaign Beta",
      "Created on": "2026-07-10T12:00:00.000Z",
      "Property Address": "",
      Notes: "Listed? No\n\nReason For Selling: Undisclosed\n\nHow Soon to Sell: Unknown",
    },
  },
  {
    why: "DM-01/PRN-05: an exact re-send of row 1 (same address+zip) ⇒ collapses on the dedupe key",
    row: {
      "Contact Name": "Dana Fake",
      phone: "(555) 555-0100",
      email: "dana@example.invalid",
      source: "Campaign Alpha",
      "Created on": "2026-07-10T16:45:00.000Z",
      "Property Address": "12 Invented St, Houston TX 77021",
      Notes: vendorANotes({ listed: "Yes", reason: "Looking For a Quick Sale", urgency: "ASAP", skipTrace: true }),
    },
  },
];

/** The rows alone, in file order — the shape parseWorkbook would hand the pipeline. */
export const LEAD_SOURCE_1_WEEK_ROWS: readonly Record<string, unknown>[] = LEAD_SOURCE_1_WEEK.map(
  (r) => r.row as unknown as Record<string, unknown>,
);
