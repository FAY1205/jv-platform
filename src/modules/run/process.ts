import { planRun, type RunRules, type PlannedLead } from "./plan";
import { buildRulesSnapshot, type RulesSnapshotInput } from "./snapshot";
import type { RunSummary } from "../analytics/run-summary";
import { renderExport, type ExportLead, type PartnerInfo } from "../export/render";
import type { HistoryEntry } from "../pipeline/dedupe";
import { isSavedProfileId, type SourceProfile } from "../sources/index";

// ─────────────────────────────────────────────────────────────────────────────
// Run orchestration (WP-017). The IMPURE conductor: it loads history/partners,
// runs the pure planRun, stamps first_matched_at from an injected clock (keeping
// the engines pure, PRN-01), builds the rules snapshot (DM-08), persists the run
// through the store (which scopes every write, PRN-08, and serializes per tenant,
// ING-06), and renders the export. All I/O is behind the injected RunStore, so the
// orchestration logic is unit-testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

/** A planned lead with first_matched_at resolved (never null once stamped). */
export type StampedLead = Omit<PlannedLead, "firstMatchedAt"> & { firstMatchedAt: string };

export interface PersistRunInput {
  tenantId: string;
  filename: string;
  rulesHash: string;
  rulesSnapshot: unknown;
  /**
   * The source_profiles FK, or null for a built-in seed (slug id, no row to point at).
   * Resolved by the caller — the store writes it verbatim into a uuid column.
   */
  sourceProfileId: string | null;
  /** The profile version this run used; set for seeds and saved profiles alike (ING-07). */
  sourceProfileVersion: number;
  year: number;
  leads: StampedLead[];
}

export interface PersistRunResult {
  uploadId: string;
  uploadRefId: string;
  /** Allocated lead ref-ids, aligned with the input leads order. */
  leadRefIds: string[];
}

export interface RunStore {
  loadHistory(tenantId: string): Promise<Map<string, HistoryEntry>>;
  loadPartners(tenantId: string): Promise<Map<string, PartnerInfo>>;
  persistRun(input: PersistRunInput): Promise<PersistRunResult>;
}

export interface RunInput {
  tenantId: string;
  filename: string;
  rows: readonly Record<string, unknown>[];
  profile: SourceProfile;
  rules: RunRules;
  snapshotInput: RulesSnapshotInput;
  /** Calendar year for ref-id allocation (passed in — never derived in pure code). */
  year: number;
  colorCoding: boolean;
}

export interface RunDeps {
  store: RunStore;
  /** ISO timestamp source for stamping first_matched_at. */
  clock: () => string;
}

export interface RunResult {
  uploadRefId: string;
  summary: RunSummary;
  exportBytes: Uint8Array;
}

function toExportLead(lead: StampedLead, refId: string): ExportLead {
  return {
    leadRefId: refId,
    campaign: lead.campaign,
    dateCreated: lead.dateCreated,
    notes: lead.notes,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    sellerFirst: lead.sellerFirst,
    sellerLast: lead.sellerLast,
    phone: lead.phone,
    email: lead.email,
    reasonForSelling: lead.reasonForSelling,
    motivation: lead.motivation,
    timeToSell: lead.timeToSell,
    partnerId: lead.partnerId,
    previouslyMatched: lead.previouslyMatched,
    possibleMlsListing: lead.possibleMlsListing,
  };
}

export async function processRun(input: RunInput, deps: RunDeps): Promise<RunResult> {
  const history = await deps.store.loadHistory(input.tenantId);
  const plan = planRun(input.rows, input.profile, input.rules, history);

  // Stamp first_matched_at: prior-run hits keep the historical value; every new lead
  // (and within-run duplicate, which carries null) is matched now.
  const runTimestamp = deps.clock();
  const stamped: StampedLead[] = plan.leads.map((lead) => ({
    ...lead,
    firstMatchedAt: lead.firstMatchedAt ?? runTimestamp,
  }));

  const { hash, snapshot } = buildRulesSnapshot(input.snapshotInput);

  // Profile provenance (ING-07): the snapshot pins id+version for reproducibility; the
  // upload columns record the same thing relationally so provenance is joinable without
  // parsing the snapshot blob. Seeds have slug ids and no row, so only the version lands.
  const persisted = await deps.store.persistRun({
    tenantId: input.tenantId,
    filename: input.filename,
    rulesHash: hash,
    rulesSnapshot: snapshot,
    sourceProfileId: isSavedProfileId(input.profile.id) ? input.profile.id : null,
    sourceProfileVersion: input.profile.version,
    year: input.year,
    leads: stamped,
  });

  const partners = await deps.store.loadPartners(input.tenantId);

  // The partner deliverable is the kept leads; removed (MLS-listed) are summarised only.
  const exportLeads: ExportLead[] = stamped
    .map((lead, i) => ({ lead, refId: persisted.leadRefIds[i] }))
    .filter(({ lead }) => lead.mlsStatus === "kept")
    .map(({ lead, refId }) => toExportLead(lead, refId));

  const exportBytes = await renderExport(exportLeads, partners, plan.summary, {
    colorCoding: input.colorCoding,
  });

  return { uploadRefId: persisted.uploadRefId, summary: plan.summary, exportBytes };
}
