import type { RunSummary } from "../analytics/run-summary";
import type { MatchMethod } from "../pipeline/assign";

// ─────────────────────────────────────────────────────────────────────────────
// Shared view types for the run UI. Type-only + free of server imports so client
// components can consume them without pulling the DB layer into the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunListItem {
  refId: string;
  filename: string;
  status: string;
  rowCount: number | null;
  createdAt: string;
}

export interface PartnerView {
  id: string;
  name: string;
  refId: string;
  color: string;
}

export interface RunLeadView {
  refId: string;
  campaignCode: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  sellerFirst: string;
  sellerLast: string;
  partnerId: string | null;
  matchMethod: MatchMethod;
  mlsStatus: "kept" | "removed";
  mlsPatternKey: string | null;
  previouslyMatched: boolean;
  possibleMlsListing: string;
}

export interface RunDetail {
  upload: { refId: string; filename: string; status: string; rowCount: number | null; createdAt: string };
  summary: RunSummary;
  distribution: { partnerId: string; count: number; name: string; refId: string; color: string }[];
  partners: Record<string, PartnerView>;
  leads: RunLeadView[];
}
