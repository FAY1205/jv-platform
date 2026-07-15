import type { SourceProfile } from "@/modules/sources";

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic multi-source week (§12.1) — stand-in until real files arrive. Two
// distinct source formats (different headers) exercise Source Profiles, leading-
// zero ZIPs, full-name vs coded states, and the MLS positive/negative/blank cases.
// Each row carries the expected outcome for the pure pipeline steps built so far;
// this is the seed of the TST-05 golden (assignments/dedupe added in Phase 1).
// ─────────────────────────────────────────────────────────────────────────────

/** A second source format ("Real Estate Bees") with renamed headers. */
export const BEES_PROFILE: SourceProfile = {
  id: "bees",
  name: "Real Estate Bees",
  version: 1,
  headerSignature: [
    "Lead Source",
    "Created",
    "Comments",
    "Street",
    "Town",
    "ST",
    "Postal",
    "First",
    "Last",
    "Phone Number",
    "Email Address",
    "Why Selling",
    "Motivation Level",
    "Timeline",
  ],
  mapping: {
    campaign: "Lead Source",
    dateCreated: "Created",
    notes: "Comments",
    address: "Street",
    city: "Town",
    state: "ST",
    zip: "Postal",
    sellerFirst: "First",
    sellerLast: "Last",
    phone: "Phone Number",
    email: "Email Address",
    reasonForSelling: "Why Selling",
    motivation: "Motivation Level",
    timeToSell: "Timeline",
  },
  requiredColumns: ["address", "zip"],
  strictness: "flexible",
};

export interface SyntheticLead {
  row: Record<string, string>;
  expect: {
    mls: "kept" | "removed";
    zip5: string;
    state: string;
    // Phase-1 runtime assignment (empty ZIP coverage → state fallback + unmatched only).
    assign: { matchMethod: "zip" | "state_fallback" | "none"; partner: string | null };
  };
}

// The ASN-01 seed state fallbacks the golden asserts against (no ZIP coverage in Phase 1).
export const SYNTH_STATE_FALLBACKS: readonly { state: string; partnerId: string }[] = [
  { state: "SC", partnerId: "Randy Wolfe" },
  { state: "VA", partnerId: "Forrest McGhee" },
  { state: "NJ", partnerId: "Josh Ax" },
  { state: "CT", partnerId: "Josh Ax" },
];

function zolo(
  campaign: string,
  notes: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  first: string,
  last: string,
  phone: string,
  expect: SyntheticLead["expect"],
): SyntheticLead {
  return {
    row: {
      Campaign: campaign,
      "Date Created": "2026-07-06",
      Notes: notes,
      Address: address,
      City: city,
      State: state,
      Zip: zip,
      "Seller First Name": first,
      "Seller Last Name": last,
      Phone: phone,
      Email: `${first}.${last}@example.test`.toLowerCase(),
      "Reason For Selling": "Relocating",
      Motivation: "High",
      "Time to Sell": "30 days",
    },
    expect,
  };
}

export const ZOLO_ROWS: SyntheticLead[] = [
  zolo("Lead Zolo", "off market, direct to seller", "142 Garden State Ave", "Cherry Hill", "New Jersey", "8034", "D", "Romano", "(856) 555-0142", { mls: "kept", zip5: "08034", state: "NJ", assign: { matchMethod: "state_fallback", partner: "Josh Ax" } }),
  zolo("Lead Zolo", "Listed on MLS ? No, MLS Date Active: 3/2/25", "77 Sound View Ter", "New Haven", "CT", "6511", "M", "Alves", "(203) 555-0119", { mls: "kept", zip5: "06511", state: "CT", assign: { matchMethod: "state_fallback", partner: "Josh Ax" } }),
  zolo("Lead Zolo", "Is it Listed? : true If Yes, MLS Date Active :", "18 Pocono Ridge Ln", "Scranton", "PA", "18503", "K", "Weiss", "(570) 555-0177", { mls: "removed", zip5: "18503", state: "PA", assign: { matchMethod: "none", partner: null } }),
  // WP-LS1: under v2 a lead is removed by the STRUCTURED listing question, so this row
  // now carries the real vendor-A form it would have in a live file.
  zolo("Lead Zolo", "Listed? Yes\n\nMLS History / Days on Market:", "311 Merrick Blvd", "Queens", "New York", "11434", "T", "Okafor", "(718) 555-0121", { mls: "removed", zip5: "11434", state: "NY", assign: { matchMethod: "none", partner: null } }),
  zolo("Lead Zolo", "", "1204 Palmetto St", "Greenville", "South Carolina", "29601", "B", "Hutto", "(864) 555-0135", { mls: "kept", zip5: "29601", state: "SC", assign: { matchMethod: "state_fallback", partner: "Randy Wolfe" } }),
  zolo("Lead Zolo", "property is not listed anywhere", "402 Blue Ridge Rd", "Roanoke", "VA", "24012", "L", "Craddock", "(540) 555-0187", { mls: "kept", zip5: "24012", state: "VA", assign: { matchMethod: "state_fallback", partner: "Forrest McGhee" } }),
  zolo("Lead Zolo", "seller has no mortgage", "3300 W 25th St", "Cleveland", "Ohio", "44113", "G", "Novak", "(216) 555-0116", { mls: "kept", zip5: "44113", state: "OH", assign: { matchMethod: "none", partner: null } }),
  // WP-LS1: v1 removed this on the free-text `mls status: active` pattern; retired in
  // v2 — only a structured listing question answered Yes disqualifies.
  zolo("Lead Zolo", "MLS status: Active", "14200 Gratiot Ave", "Detroit", "MI", "48205", "E", "Willis", "(313) 555-0128", { mls: "kept", zip5: "48205", state: "MI", assign: { matchMethod: "none", partner: null } }),
];

function bees(
  comments: string,
  street: string,
  town: string,
  st: string,
  postal: string,
  first: string,
  last: string,
  expect: SyntheticLead["expect"],
): SyntheticLead {
  return {
    row: {
      "Lead Source": "Real Estate Bees",
      Created: "2026-07-06",
      Comments: comments,
      Street: street,
      Town: town,
      ST: st,
      Postal: postal,
      First: first,
      Last: last,
      "Phone Number": "(843) 555-0108",
      "Email Address": `${first}.${last}@example.test`.toLowerCase(),
      "Why Selling": "Estate sale",
      "Motivation Level": "Medium",
      Timeline: "60 days",
    },
    expect,
  };
}

export const BEES_ROWS: SyntheticLead[] = [
  bees("off market", "88 Lowcountry Dr", "Beaufort", "SC", "29902", "S", "Pinckney", { mls: "kept", zip5: "29902", state: "SC", assign: { matchMethod: "state_fallback", partner: "Randy Wolfe" } }),
  bees("Is it listed : Y — wants to cancel", "19 Shore Rd", "Toms River", "NJ", "8753", "R", "Delgado", { mls: "removed", zip5: "08753", state: "NJ", assign: { matchMethod: "state_fallback", partner: "Josh Ax" } }),
  bees("never listed on any site", "9 Huntington Bay Rd", "Shelton", "CT", "06484", "R", "Delgado", { mls: "kept", zip5: "06484", state: "CT", assign: { matchMethod: "state_fallback", partner: "Josh Ax" } }),
  // WP-LS1: the real vendor-B structured form (v2 removes on this, not on prose).
  bees("* Listed with realtor?: Yes\n* Listed on MLS?:", "2216 Pine St", "Philadelphia", "PA", "19103", "A", "Boyd", { mls: "removed", zip5: "19103", state: "PA", assign: { matchMethod: "none", partner: null } }),
  bees("no mls, wants cash", "1121 Oceana Ct", "Virginia Beach", "VA", "23451", "P", "Mateo", { mls: "kept", zip5: "23451", state: "VA", assign: { matchMethod: "state_fallback", partner: "Forrest McGhee" } }),
  bees("", "540 5th Ave", "Brooklyn", "NY", "11215", "J", "Cohen", { mls: "kept", zip5: "11215", state: "NY", assign: { matchMethod: "none", partner: null } }),
];
