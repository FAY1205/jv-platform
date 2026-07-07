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

export const SEED_SOURCE_PROFILES: readonly SourceProfile[] = [GENERIC_PROFILE];
