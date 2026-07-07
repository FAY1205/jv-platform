import type { SourceProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Seed Source Profiles (SEAM-05). Seed for the source_profiles table; admins
// create/version profiles from the upload flow (ING-02), never pre-configured
// as a prerequisite. This generic profile maps the canonical column set (ING-03).
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// InvestorFuse Source Profile v1 (ING-02/03/07). The real weekly CRM export:
// 61 columns. The property block (Street Address/City/State/Zip Code, cols 4-7)
// is distinct from the seller block (Seller Street Address/City/State/Zip Code,
// cols 14-17) — the ASSIGNMENT territory key is the PROPERTY Zip Code (col 7),
// never Seller Zip Code (col 17). Canonical `notes` = `Notes` (col 39) ONLY:
// `Comments` (col 40) holds call-logs + seller PII and never the "is it listed?"
// signal, so it stays in raw_json (DM-02). Owner-confirmed 2026-07-07 (WP-013).
// Flexible strictness: InvestorFuse adds/removes CRM columns week to week; extras
// are preserved in raw_json and drift on the mapped columns is caught by ING-08.
// ─────────────────────────────────────────────────────────────────────────────

export const INVESTORFUSE_PROFILE: SourceProfile = {
  id: "investorfuse",
  name: "InvestorFuse",
  version: 1,
  headerSignature: [
    "Campaign",
    "Additional Campaigns",
    "Id",
    "Street Address",
    "City",
    "State",
    "Zip Code",
    "Owner",
    "Seller Id",
    "Seller First Name",
    "Seller Last Name",
    "Seller Email",
    "Seller Phone",
    "Seller Street Address",
    "Seller City",
    "Seller State",
    "Seller Zip Code",
    "Property Type",
    "Bedrooms",
    "Bathrooms",
    "Size (SQFT)",
    "Lot Size",
    "Basement",
    "Year Built",
    "Repairs",
    "Link to Files",
    "Subdivision",
    "Asking Price",
    "Listed Price",
    "Market Value",
    "Mortgage",
    "Monthly Payment",
    "Taxes",
    "Renting For",
    "Going Rental Rate",
    "Reason For Selling",
    "Motivation",
    "Time To Sell",
    "Notes",
    "Comments",
    "Pipeline",
    "Sub-Pipeline",
    "Status",
    "Group",
    "Touches",
    "Contacted Type",
    "Dead Type",
    "Dead Reason",
    "Secondary Owner",
    "Resurfaced Count",
    "Date of Last Touch",
    "Date Created",
    "Date Qualified",
    "Date of 1st Appointment",
    "Date of 1st Offer",
    "Contract Date",
    "Date of Going Under Contract",
    "Date Cancelled",
    "Date Closed",
    "Resurfaced Date",
    "Dead Date",
  ],
  mapping: {
    campaign: "Campaign",
    dateCreated: "Date Created",
    notes: "Notes", // col 39 — NOT Comments (col 40); resolved open question
    address: "Street Address", // property, not Seller Street Address
    city: "City",
    state: "State", // property, not Seller State
    zip: "Zip Code", // property territory key, not Seller Zip Code
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

export const SEED_SOURCE_PROFILES: readonly SourceProfile[] = [
  INVESTORFUSE_PROFILE,
  GENERIC_PROFILE,
];
