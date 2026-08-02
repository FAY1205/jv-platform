import type { SourceProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Seed Source Profiles (SEAM-05). Seed for the source_profiles table; admins
// create/version profiles from the upload flow (ING-02), never pre-configured as a
// prerequisite.
//
// WP-LS1 (owner decision 2026-07-15): the CRM "opportunities" export is the ONLY
// upload format now, so it is the only seed. The vendor is never named — it is
// "Lead Source 1" in code, UI, and docs. The retired InvestorFuse/Generic profiles
// live on in git history; their DB rows are removed by migration 0023 (they had
// zero uploads referencing them).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lead Source 1 v1 (ING-02/03/07). The real CRM export: 179 columns, two vendor
 * note-templates inside one file. Verified against 182 real rows (2026-07-15).
 *
 * Only 5 columns map directly. Everything else a partner sees is DERIVED by the
 * "lead-source-1" transform (see ./transforms.ts), because this export has no
 * usable address/name/reason columns:
 *   • the dedicated "State", "Timeline To Sell", "Seller 1 *" and "⚪️ *" columns
 *     are 0% populated — empty CRM scaffolding;
 *   • the seller name arrives as one "Contact Name" field;
 *   • address/city/state/zip live inside "Property Address";
 *   • reasonForSelling / timeToSell live inside the "Notes" blob.
 *
 * Strictness is flexible: the CRM adds/removes columns, extras are preserved in
 * raw_json, and drift on the MAPPED columns still triggers ING-08 diff-and-confirm.
 */
export const LEAD_SOURCE_1_PROFILE: SourceProfile = {
  id: "lead-source-1",
  name: "Lead Source 1",
  version: 1,
  headerSignature: [
    // WP-LS1 fix: the ~180-column CRM export is detected on ONLY the columns the
    // mapping + transform actually consume. The rest are volatile scaffolding that
    // varies week to week (preserved in raw_json). Detecting on the full dump made
    // every real export "drift" and forced a needless remap every upload. Flexible +
    // order-independent: these 7 present (everything else extra) auto-applies; a
    // rename/removal of one of THESE still triggers ING-08 diff-and-confirm.
    "Contact Name",
    "Property Address",
    "Notes",
    "Created on",
    "phone",
    "email",
    "source",
  ],
  mapping: {
    campaign: "source",
    dateCreated: "Created on", // ISO timestamp → plain date in the transform
    notes: "Notes", // pre-strip; the transform removes the skip-trace block (SEC-05)
    phone: "phone",
    email: "email",
  },
  // Derived from Property Address (with a notes-line fallback) by the transform, so
  // neither can be a required COLUMN here; a row that resolves to neither still
  // ingests and surfaces in Unmatched (PRN-03), reported by findRowErrors.
  requiredColumns: [],
  strictness: "flexible",
  transform: "lead-source-1",
};

// ─────────────────────────────────────────────────────────────────────────────
// RETIRED FORMATS (WP-LS1). Removed from the seed list above — they are never
// offered for detection, never seeded, and their DB rows are dropped by migration
// 0023. The constants survive only as vehicles for tests and dev tooling:
// GENERIC_PROFILE is the small, readable profile the detection/mapping/drift suites
// exercise the engine with (the 179-column LS1 profile would make those unreadable),
// and INVESTORFUSE_PROFILE backs the local demo seeder. Nothing in the product
// imports them. Folding them into tests/fixtures is a WP candidate, not this WP.
// ─────────────────────────────────────────────────────────────────────────────

/** RETIRED (WP-LS1) — not seeded. Test vehicle for the detection/mapping engine. */
export const GENERIC_PROFILE: SourceProfile = {
  id: "generic",
  name: "Generic",
  version: 1,
  headerSignature: [
    "Campaign",
    "Date Created",
    "Notes",
    "Address",
    "City",
    "State",
    "Zip",
    "Seller First Name",
    "Seller Last Name",
    "Phone",
    "Email",
    "Reason For Selling",
    "Motivation",
    "Time to Sell",
  ],
  mapping: {
    campaign: "Campaign",
    dateCreated: "Date Created",
    notes: "Notes",
    address: "Address",
    city: "City",
    state: "State",
    zip: "Zip",
    sellerFirst: "Seller First Name",
    sellerLast: "Seller Last Name",
    phone: "Phone",
    email: "Email",
    reasonForSelling: "Reason For Selling",
    motivation: "Motivation",
    timeToSell: "Time to Sell",
  },
  requiredColumns: ["address", "zip"],
  strictness: "flexible",
};

/** RETIRED (WP-LS1) — not seeded. Retained for the local demo seeder only. */
export const INVESTORFUSE_PROFILE: SourceProfile = {
  id: "investorfuse",
  name: "InvestorFuse",
  version: 1,
  headerSignature: [
    "Campaign", "Additional Campaigns", "Id", "Street Address", "City", "State",
    "Zip Code", "Owner", "Seller Id", "Seller First Name", "Seller Last Name",
    "Seller Email", "Seller Phone", "Seller Street Address", "Seller City",
    "Seller State", "Seller Zip Code", "Property Type", "Bedrooms", "Bathrooms",
    "Size (SQFT)", "Lot Size", "Basement", "Year Built", "Repairs", "Link to Files",
    "Subdivision", "Asking Price", "Listed Price", "Market Value", "Mortgage",
    "Monthly Payment", "Taxes", "Renting For", "Going Rental Rate",
    "Reason For Selling", "Motivation", "Time To Sell", "Notes", "Comments",
    "Pipeline", "Sub-Pipeline", "Status", "Group", "Touches", "Contacted Type",
    "Dead Type", "Dead Reason", "Secondary Owner", "Resurfaced Count",
    "Date of Last Touch", "Date Created", "Date Qualified",
    "Date of 1st Appointment", "Date of 1st Offer", "Contract Date",
    "Date of Going Under Contract", "Date Cancelled", "Date Closed",
    "Resurfaced Date", "Dead Date",
  ],
  mapping: {
    campaign: "Campaign",
    dateCreated: "Date Created",
    notes: "Notes",
    address: "Street Address",
    city: "City",
    state: "State",
    zip: "Zip Code",
    sellerFirst: "Seller First Name",
    sellerLast: "Seller Last Name",
    phone: "Seller Phone",
    email: "Seller Email",
    reasonForSelling: "Reason For Selling",
    motivation: "Motivation",
    timeToSell: "Time To Sell",
  },
  requiredColumns: ["address", "zip"],
  strictness: "flexible",
};

/**
 * ING-02: the ONLY format offered for detection (owner decision 2026-07-15).
 * An old-format upload now falls through to `unknown` → inline mapping, by design.
 */
export const SEED_SOURCE_PROFILES: readonly SourceProfile[] = [LEAD_SOURCE_1_PROFILE];
