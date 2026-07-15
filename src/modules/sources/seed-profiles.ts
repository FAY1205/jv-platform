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
    "Opportunity name",
    "Contact Name",
    "phone",
    "email",
    "pipeline",
    "stage",
    "Lead Value",
    "source",
    "assigned",
    "Created on",
    "Updated on",
    "lost reason ID",
    "lost reason name",
    "Followers",
    "Notes",
    "tags",
    "Engagement score",
    "status",
    "Expected Close Date",
    "Forecast Probability",
    "Forecast Slippage Count",
    "Forecast Slippage (Days)",
    "⚠️ Dispo Key Notes",
    "⚠️ Interested Buyers, Feedback & Offers",
    "AB | Contract Date",
    "AB | COE",
    "Dispo ARV",
    "BC | Dispo Price",
    "BC | Dispo Price Drop",
    "AB | Buy Price",
    "AB | Buy Price Drop",
    "Deal Profit",
    "Closing Strategy",
    "Notes From Acquisitions",
    "Photo Links",
    "JV Deal Details (If Applicable)",
    "📣 MARKETING ENGINE",
    "Marketing Description",
    "Marketing Week",
    "Marketing Checklist",
    "Marketing Activity",
    "Send to JV Partners",
    "🚀 DISPO SALES",
    "Sales RP Checklist",
    "🏦 DISPO | BC SALES CONTRACT ENGINE",
    "Reset Sales Contract Fields",
    "Dispo Rep",
    "BC Cash Buyer Source",
    "BC Buyer Name",
    "BC Buyer Email",
    "BC Sales Price",
    "BC EMD",
    "BC COE",
    "BC Contract Date",
    "BC Additional Terms & Conditions",
    "BC Addendum Terms",
    "BC Agreement Generator",
    "BC | Agreement System Notes",
    "Ops - Secondary Market MAO",
    "Ops - Primary Market Low Anchor Offer",
    "Ops - Primary Market MAO",
    "Ops - Premium Market MAO",
    "Ops - Wholetail - Novation MAO",
    "Ops - Creative Finance MAO",
    "Ops - Run Analysis",
    "Ops - API | Property Details",
    "Ops - Lead Intake Date",
    "☎️ Contacts to Date",
    "Ops - AI Classified Date",
    "Ops - Blank",
    "Ops - Lead Conversion Date",
    "Timeline To Sell",
    "Ops - Prospect Conversion Date",
    "⚠️ Acq Key Notes",
    "⚡️ PROPERTY DETAILS",
    "Property Address",
    "Closest Metro Area",
    "Zillow Link",
    "Online ARV Est.",
    "Discovery Conversation Notes (C-T-M-P)",
    "Property Info Links",
    "Property Type",
    "Beds, Baths & Extras",
    "Year Built",
    "Lot Size",
    "Square Feet",
    "Est. Rehab Per Sq Ft ( ⬆️ Must Have Sq Ft )",
    "Update.",
    "Est. Rehab Amount",
    "Comparables",
    "Lowest Active Comp",
    "Area Investor Buy Price Average",
    "Confirmed ARV",
    "🎯 OFFER THRESHOLDS",
    "Underwriter",
    "Update..",
    "Secondary Market MAO",
    "Low Anchor",
    "MAO",
    "Premium MAO",
    "Creative MAO",
    "Wholetail / Novation MAO",
    "Novation Listing Price",
    "🚀 OFFER",
    "Contract Offer",
    "Est. Ws Dispo Price",
    "Est. Ws Profit",
    "Est. Novation Profit",
    "🏦 ACQ | AB PURCHASE CONTRACT ENGINE",
    "Terms",
    "Seller 1 Name",
    "Seller 1 Phone",
    "Seller 1 Email",
    "Seller 2 Name",
    "Seller 2 Email",
    "AB COE",
    "AB EMD",
    "Parcel Number",
    "Legal Description",
    "Release of Information Parties",
    "Additional Terms & Conditions",
    "Creative Financing Terms & Conditions",
    "Addendum Terms & Conditions",
    "AB | Agreement Generator",
    "AB | Agreement System Notes",
    "✅ ACQ CHECKLIST",
    "Seller Situation",
    "Occupancy",
    "Access Info",
    "Things Dispo Needs to Know about...",
    "Acq Requirements Checklist",
    "Send to Dispo",
    "Update...",
    "State",
    "⚪️ Property Address",
    "⚪️ Seller",
    "⚪️ Buyer",
    "⚪️ Lead Source",
    "⚪️ Acquisition Price",
    "⚪️ Disposition Price",
    "⚪️ Gross Revenue",
    "⚪️ Lead Gen Team",
    "⚪️ Acquisition Team",
    "⚪️ Disposition Team",
    "⚪️ AB Contract Date",
    "⚪️ BC COE",
    "Lead Conversion Cycle (Days)",
    "Dispo Sales Cycle (Days)",
    "📆 Next Contact Date",
    "🔴 Send to Auto Follow Up Sequence",
    "☎️ Send to Power Dialer",
    "⚠️ TC Key Notes",
    "TC Name",
    "AB Seller(s) Contact Info",
    "Title & Escrow Contact Info",
    "AB EMD Required?",
    "AB EMD Amount",
    "FIle Requirements",
    "BC Buyer Contact Info",
    "BC Contract Signature Date",
    "AB Access Granted On",
    "Other Transaction Contacts",
    "AB Due Diligence Expiration",
    "Transaction Expenses (Itemized)",
    "Transaction Expenses Total",
    "TC Document | Engine",
    "TC Document | System Notes",
    "🏁 FINAL NUMBERS",
    "Final Sales Price (Settlement Statement)",
    "Final Gross Revenue (Settlement Statement)",
    "Final Net Revenue",
    "Finalize Deal",
    "Opportunity ID",
    "Contact ID",
    "Pipeline Stage ID",
    "Pipeline ID",
    "Days since last stage change",
    "Days since last status change",
    "Days since last update",
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
