import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Data model (spec §5, DM-01..11). Every table carries tenant_id (SCP-01,
// SEAM-01); every list/query path has its index (DM-11). RLS policies live in
// the SQL migration alongside this schema (API-04). Timestamps are UTC (DM-05).
// ─────────────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["admin", "partner"]);
export const partnerStatusEnum = pgEnum("partner_status", [
  "not_invited",
  "invited",
  "active",
  "revoked",
]);
export const matchMethodEnum = pgEnum("match_method", ["zip", "state_fallback", "none"]);
export const mlsStatusEnum = pgEnum("mls_status", ["kept", "removed"]);
// Lead scoring (SCR-01..10). Group is null until a lead scores; status distinguishes
// a real 0 from "not enough data to score".
export const scoreGroupEnum = pgEnum("score_group", ["hot", "warm", "nurture"]);
export const scoreStatusEnum = pgEnum("score_status", ["complete", "incomplete"]);
export const possibleMlsEnum = pgEnum("possible_mls", ["yes", "no", "unknown", "pending"]);
export const uploadStatusEnum = pgEnum("upload_status", [
  "queued",
  "processing",
  "processed",
  "voided",
]);
export const patternTypeEnum = pgEnum("pattern_type", ["disqualify", "keep_override"]);
export const strictnessEnum = pgEnum("strictness", ["flexible", "strict"]);
export const authorRoleEnum = pgEnum("author_role", ["admin", "partner"]);
export const listingStatusEnum = pgEnum("listing_status", ["pending", "yes", "no", "unknown"]);
export const refEntityEnum = pgEnum("ref_entity", ["partner", "lead", "upload"]);
export const feedbackRatingEnum = pgEnum("feedback_rating", ["up", "down"]);
export const idempotencyStatusEnum = pgEnum("idempotency_status", ["in_progress", "completed"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── Tenancy & identity ──
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  // LGL-01 (WP-SU-5): true when this tenant was created by PUBLIC self-serve signup, whose
  // admin accepted the ToS at provisioning. Owner/script-provisioned tenants are false and
  // stay exempt from the admin ToS gate — they have no acceptance record, so gating every
  // admin would lock the owner out of their own app.
  selfServe: boolean("self_serve").notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    // Mirrors the Supabase auth user id.
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    partnerId: uuid("partner_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("users_tenant_idx").on(t.tenantId),
    uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
  ],
);

export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    refId: text("ref_id").notNull(), // PR-### (DM-07; JV- renamed by migration 0022)
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    color: text("color").notNull(), // locked hex (PRN-06)
    dealTerms: text("deal_terms"),
    adminNotes: text("admin_notes"),
    status: partnerStatusEnum("status").notNull().default("not_invited"),
    // WP-D (ADR-0037): the tenant's own "house" territory — ZIPs/states the admin manages
    // themselves. Modeled as a partner row so it flows through coverage, routing, and every map
    // with zero pipeline special-casing (ASN-02); the distinction is purely presentational. At
    // most one active house per tenant, enforced by a partial unique index in migration 0031.
    isHouse: boolean("is_house").notNull().default(false),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastPortalLoginAt: timestamp("last_portal_login_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete (DM-09)
    createdAt: createdAt(),
  },
  (t) => [
    index("partners_tenant_idx").on(t.tenantId),
    uniqueIndex("partners_tenant_ref_idx").on(t.tenantId, t.refId),
  ],
);

// ── Rules-as-data (PRN-07) ──
export const coverageZips = pgTable(
  "coverage_zips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    zip5: text("zip5").notNull(),
    county: text("county"),
    region: text("region"),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id),
    version: integer("version").notNull().default(1),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }), // null = current (DM-06)
    createdAt: createdAt(),
  },
  (t) => [
    // Unique CURRENT coverage per (tenant, zip5): enforced by a partial unique
    // index in the RLS/constraints migration (WHERE effective_to IS NULL).
    index("coverage_tenant_zip_idx").on(t.tenantId, t.zip5),
    // FK-covering index (db-linter 0001): the partner_id FK had no leading-column index.
    index("coverage_zips_partner_idx").on(t.partnerId),
  ],
);

export const stateRules = pgTable(
  "state_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    state: text("state").notNull(), // 2-letter
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("state_rules_tenant_state_idx").on(t.tenantId, t.state),
    // FK-covering index (db-linter 0001): the partner_id FK had no leading-column index.
    index("state_rules_partner_idx").on(t.partnerId),
  ],
);

export const mlsPatterns = pgTable(
  "mls_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    patternKey: text("pattern_key").notNull(), // stable id e.g. dq_is_listed_yes
    type: patternTypeEnum("type").notNull(),
    regex: text("regex").notNull(),
    flags: text("flags").notNull().default("i"),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mls_patterns_tenant_key_idx").on(t.tenantId, t.patternKey)],
);


export const sourceProfiles = pgTable(
  "source_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    headerSignature: jsonb("header_signature").notNull(),
    mapping: jsonb("mapping").notNull(),
    requiredColumns: jsonb("required_columns").notNull(),
    strictness: strictnessEnum("strictness").notNull().default("flexible"),
    // WP-LS1 (SEAM): names a PURE transform registered in src/modules/sources/transforms.ts,
    // run after column mapping for fields mapping cannot reach. MUST persist: detection
    // prefers saved rows over the code seeds, so a row that lost its transform would
    // silently ingest leads with no address/name and un-stripped notes (SEC-05).
    transform: text("transform"),
    createdAt: createdAt(),
  },
  (t) => [index("source_profiles_tenant_idx").on(t.tenantId)],
);

// ── Uploads & leads ──
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    refId: text("ref_id").notNull(), // IM-YY-### (DM-07, ADR-0019 v2)
    filename: text("filename").notNull(),
    storagePath: text("storage_path"),
    sourceProfileId: uuid("source_profile_id").references(() => sourceProfiles.id),
    sourceProfileVersion: integer("source_profile_version"),
    status: uploadStatusEnum("status").notNull().default("queued"),
    rowCount: integer("row_count"),
    rulesHash: text("rules_hash"), // rules snapshot (DM-08)
    rulesSnapshot: jsonb("rules_snapshot"),
    // ADR-0038: SHA-256 of the raw uploaded file — powers the identical-file re-upload
    // warn-and-confirm. NULL for pre-ADR uploads (never backfilled).
    contentHash: text("content_hash"),
    voidReason: text("void_reason"), // ING-09
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    // Distribution hold: NULL = the partner push (digest + notifications) hasn't been sent yet.
    // Set by the release cron once the import is past its hold window. Visibility does NOT depend
    // on this column (it's computed at read time from the lead's created_at) — this marker is only
    // the push's idempotency, so a stalled cron delays emails, never lead access.
    distributedAt: timestamp("distributed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("uploads_tenant_idx").on(t.tenantId),
    uniqueIndex("uploads_tenant_ref_idx").on(t.tenantId, t.refId),
    // Release scan: only imports still awaiting their push (not yet distributed, not voided).
    index("uploads_pending_release_idx")
      .on(t.tenantId, t.createdAt)
      .where(sql`${t.distributedAt} is null and ${t.voidedAt} is null`),
    // ADR-0038: duplicate-file lookup — "has this tenant already imported these bytes?"
    index("uploads_tenant_content_hash_idx").on(t.tenantId, t.contentHash),
    // FK-covering index (db-linter 0001): the source_profile_id FK had no leading-column index.
    index("uploads_source_profile_idx").on(t.sourceProfileId),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    refId: text("ref_id").notNull(), // LD-YY-##### (DM-07, ADR-0019 v2)
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id),
    dedupeKey: text("dedupe_key").notNull(), // normalized(address)+zip5 (DM-01)
    rawJson: jsonb("raw_json").notNull(), // full source row forever (DM-02)
    // Canonical fields (ING-03)
    campaign: text("campaign"),
    dateCreated: text("date_created"),
    notes: text("notes"),
    address: text("address"),
    addressNormalized: text("address_normalized"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    sellerFirst: text("seller_first"),
    sellerLast: text("seller_last"),
    phone: text("phone"),
    phoneNorm: text("phone_norm"),
    email: text("email"),
    reasonForSelling: text("reason_for_selling"),
    motivation: text("motivation"),
    timeToSell: text("time_to_sell"),
    // Decision columns (DM-03)
    partnerId: uuid("partner_id").references(() => partners.id),
    matchMethod: matchMethodEnum("match_method").notNull().default("none"),
    // DM-03: the exact ZIP5 or state code the router matched on (assign.ts matchedOn).
    // NULL for an unmatched lead. Written once at insert, never rewritten (PRN-05);
    // shown in the lead dialog.
    matchedOn: text("matched_on"),
    mlsStatus: mlsStatusEnum("mls_status").notNull().default("kept"),
    mlsReason: text("mls_reason"),
    mlsPatternKey: text("mls_pattern_key"),
    mlsMatchSpan: jsonb("mls_match_span"), // {start,end,text} (MLS-05)
    previouslyMatched: boolean("previously_matched").notNull().default(false),
    originalPartnerId: uuid("original_partner_id").references(() => partners.id),
    firstMatchedAt: timestamp("first_matched_at", { withTimezone: true }),
    possibleMlsListing: possibleMlsEnum("possible_mls_listing").notNull().default("pending"),
    // Scoring (SCR-01..10). Computed at import from the RESIDI scheme (score.ts,
    // pinned by SCORING_VERSION in the run's rules snapshot). scoreTotal/scoreGroup
    // are NULL when scoreStatus = 'incomplete' (a required input was missing);
    // scoreBreakdown holds the per-criterion points + labels for the lead dialog.
    scoreTotal: integer("score_total"),
    scoreGroup: scoreGroupEnum("score_group"),
    scoreStatus: scoreStatusEnum("score_status").notNull().default("incomplete"),
    scoreBreakdown: jsonb("score_breakdown"),
    // Manual-assignment overlay (ADM / ASN-03). ADDITIVE — the snapshot columns
    // (partnerId / matchMethod) are NEVER rewritten (PRN-05: history is immutable).
    // The "effective" owner is manualPartnerId ?? partnerId, derived in the read
    // layer; only currently-unmatched leads may be manually assigned.
    manualPartnerId: uuid("manual_partner_id").references(() => partners.id),
    manualAssignedAt: timestamp("manual_assigned_at", { withTimezone: true }),
    manualAssignedBy: uuid("manual_assigned_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete (DM-09)
    // WP-GL-B: stamped when the retention sweep redacts this soft-deleted lead's seller PII
    // (DM-09 hard-delete-via-retention / LGL-02 grace). NULL = not yet purged; the sweep's
    // idempotency + selectivity both key off it. PII lives on until then (DM-02 for live leads).
    piiPurgedAt: timestamp("pii_purged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // ADR-0038: dedup collapse retired — dedupe_key is stored for grouping/reporting only,
    // so the old partial UNIQUE became a plain index (same-key rows are now legitimate).
    index("leads_tenant_dedupe_idx").on(t.tenantId, t.dedupeKey),
    index("leads_tenant_upload_idx").on(t.tenantId, t.uploadId),
    index("leads_tenant_partner_created_idx").on(t.tenantId, t.partnerId, t.createdAt),
    index("leads_tenant_manual_partner_idx").on(t.tenantId, t.manualPartnerId),
    // Leads-list query indexes (F-09): the global admin list filters/sorts by these.
    index("leads_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("leads_tenant_state_idx").on(t.tenantId, t.state),
    index("leads_tenant_campaign_idx").on(t.tenantId, t.campaign),
    // Hot-lead filter (SCR / F-09): the leads list can filter to a score group; keyed
    // with created_at so "hot leads, newest first" is index-covered (DM-11).
    index("leads_tenant_score_idx").on(t.tenantId, t.scoreGroup, t.createdAt),
    // WP-GL-B: the retention sweep scans only soft-deleted-not-yet-purged rows — a small set —
    // so a partial index keyed on exactly that predicate keeps the sweep cheap at any table size.
    index("leads_pii_purge_idx")
      .on(t.tenantId, t.deletedAt)
      .where(sql`${t.piiPurgedAt} is null and ${t.deletedAt} is not null`),
    // FK-covering indexes (db-linter 0001): each partner/upload FK had only composite
    // indexes LEADING with tenant_id, which cannot serve a lookup on the FK column alone
    // (e.g. the reference check when a partner or upload row is deleted).
    index("leads_partner_idx").on(t.partnerId),
    index("leads_original_partner_idx").on(t.originalPartnerId),
    index("leads_manual_partner_idx").on(t.manualPartnerId),
    index("leads_upload_idx").on(t.uploadId),
  ],
);

// ── Engagement ──
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    authorRole: authorRoleEnum("author_role").notNull(), // visibility boundary (PRN-13, DM-10)
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("lead_notes_lead_idx").on(t.leadId),
    // noteWhere's same-partner-org author predicate filters by author (DM-11).
    index("lead_notes_author_user_idx").on(t.authorUserId),
    // FK-covering index (db-linter 0001): the tenant_id FK had no leading-column index.
    index("lead_notes_tenant_idx").on(t.tenantId),
  ],
);

// WP-TSK-1 (TSK-01..03, ADR-0044): tasks are the work layer on a lead. Two-stream like
// lead_notes — author_role is the visibility boundary (PRN-13), and a task never follows
// the lead on re-route (taskWhere restricts to own-org authors, exactly noteWhere's
// shape). done_at null = open; reminded_at stamps the one-time due nudge (TSK-08).
export const leadTasks = pgTable(
  "lead_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    authorRole: authorRoleEnum("author_role").notNull(), // visibility boundary (PRN-13, ADR-0044)
    // TSK-03: must belong to the author's stream; null = the creator's own task. The
    // column lands now so multi-seat partner orgs need no schema change later.
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    title: text("title").notNull(),
    dueOn: date("due_on"), // calendar date, UTC semantics (TSK-10)
    doneAt: timestamp("done_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("lead_tasks_lead_idx").on(t.leadId),
    // FK-covering indexes (db-linter 0001 precedent): every FK gets a leading-column index.
    index("lead_tasks_tenant_idx").on(t.tenantId),
    index("lead_tasks_author_user_idx").on(t.authorUserId),
    index("lead_tasks_assignee_idx").on(t.assignedToUserId),
    // The reminder sweep (TSK-08) and My Tasks grouping (TSK-07) scan OPEN tasks by due
    // date; the partial index keeps that scan off completed rows.
    index("lead_tasks_open_due_idx")
      .on(t.tenantId, t.dueOn)
      .where(sql`done_at is null`),
  ],
);

// WP-TAG-1 (TAG-01): tenant-owned workflow LABELS on a lead. Deliberately NOT the
// two-stream shape lead_notes/lead_tasks carry — tags are admin-only in v1 (owner
// decision at mockup sign-off), so there is no author_role column to filter on and the
// visibility boundary is tenant + the route's admin gate (see modules/tags/tags.ts).
// `color` stores a PALETTE KEY (lib/tokens TAG_PALETTE), never a hex — the component
// layer resolves it to semantic token classes (PRN-12), so a rebrand never rewrites data.
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // FK-covering index (db-linter 0001 precedent) + the list read's leading column.
    index("tags_tenant_idx").on(t.tenantId),
    // TAG-01: names are unique per tenant CASE-INSENSITIVELY — "Probate" and "probate"
    // are one label. Expression index, so the constraint is enforced in the DB rather
    // than by a racy pre-read in the command.
    uniqueIndex("tags_tenant_name_idx").on(t.tenantId, sql`lower(${t.name})`),
  ],
);

// TAG-01: the lead ↔ tag junction. A surrogate id (not a composite PK) keeps the audit
// entityRef and any future per-attachment column simple; (lead_id, tag_id) is UNIQUE, which
// is what makes attach idempotent at the DB level (onConflictDoNothing).
export const leadTags = pgTable(
  "lead_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("lead_tags_lead_tag_idx").on(t.leadId, t.tagId),
    // FK-covering indexes: every FK gets a leading-column index (db-linter 0001).
    index("lead_tags_tenant_idx").on(t.tenantId),
    index("lead_tags_tag_idx").on(t.tagId),
    index("lead_tags_added_by_idx").on(t.addedByUserId),
  ],
);

// WP-SV-1 (SV-01): a saved leads-page view — a NAME over the whole filter state. Per USER,
// not per tenant: two admins in one tenant work different books, and a view is a personal
// bookmark (the owner decision at mockup sign-off — shared/team views are explicitly out of
// v1). That per-user pin is the table's whole visibility rule and it is enforced three times
// over: the module predicate (modules/saved-views), the RLS policy's BOTH halves (0043), and
// the fact that `user_id` is only ever written from the server scope.
//
// `filters` is jsonb, validated against modules/saved-views/schema before it is ever written
// (SV-02) — the blob is composed from the leads list's own query validators, so it can hold
// nothing the list cannot apply. Deliberately NOT normalized into columns: the filter state is
// a UI shape that will keep growing, and a column per filter would make every new filter a
// migration for data that is only ever read as a whole.
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // SV-01: unique per USER, case-insensitively (the tags precedent — "Hot in AZ" and
    // "hot in az" are one view). Expression index, so the DB is the only duplicate check and
    // two concurrent saves cannot race past a pre-read. It also LEADS with user_id, which is
    // both the FK-covering index for user_id (db-linter 0001) and the list read's own index.
    uniqueIndex("saved_views_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    // FK-covering index for tenant_id.
    index("saved_views_tenant_idx").on(t.tenantId),
  ],
);

export const leadStatusHistory = pgTable(
  "lead_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    status: text("status").notNull(), // status list is tenant-editable (SEAM-06)
    changedByUserId: uuid("changed_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("lead_status_lead_idx").on(t.leadId),
    // FK-covering indexes (db-linter 0001). changed_by_user_id also backs the R-22 policy
    // (0037) predicate `changed_by_user_id IN (...)`; tenant_id had no leading-column index.
    index("lead_status_history_changed_by_idx").on(t.changedByUserId),
    index("lead_status_history_tenant_idx").on(t.tenantId),
  ],
);

export const listingChecks = pgTable(
  "listing_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    provider: text("provider").notNull(),
    status: listingStatusEnum("status").notNull().default("pending"),
    result: jsonb("result"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("listing_checks_lead_idx").on(t.leadId),
    // FK-covering index (db-linter 0001): the tenant_id FK had no leading-column index.
    index("listing_checks_tenant_idx").on(t.tenantId),
  ],
);

// ── Notifications, audit ──
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    deepLink: text("deep_link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    // FK-covering index (db-linter 0001): the tenant_id FK had no leading-column index.
    index("notifications_tenant_idx").on(t.tenantId),
  ],
);

// The `events` table was removed in WS-9 / migration 0015 (ADR-0020): it had a
// single writer and no reader, redundant with lead_status_history. The lead
// lifecycle stream role stays with lead_status_history + audit_log; a future
// webhooks/member-feed phase can reintroduce a purpose-built stream (SEAM-04).

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityRef: text("entity_ref"),
    before: jsonb("before"),
    after: jsonb("after"),
    traceId: text("trace_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// Outbound email outbox (NTF-03). Every digest/notification is enqueued here, then
// drained through the sendEmail seam (Resend in prod, the SEC-07 sink in non-prod)
// with delivery status + retry/backoff. Server-managed (service role); deny-by-default RLS.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    toAddress: text("to_address").notNull(), // intended recipient (real email, even in dev)
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    html: text("html"), // rendered HTML alternative (NTF-03/WP-G); null → text-only send
    kind: text("kind").notNull(), // partner_digest | admin_run_summary | ...
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    providerId: text("provider_id"), // Resend message id / dev id
    sentAt: timestamp("sent_at", { withTimezone: true }),
    meta: jsonb("meta"), // {uploadRef, partnerRef, ...} (SEAM-04 linkage)
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("outbox_status_next_idx").on(t.status, t.nextAttemptAt),
  ],
);

// ── Settings, flags, AI ──
export const settings = pgTable(
  "settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("settings_tenant_key_idx").on(t.tenantId, t.key)],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feature_flags_tenant_key_idx").on(t.tenantId, t.key)],
);

export const aiMemory = pgTable(
  "ai_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_memory_tenant_idx").on(t.tenantId)],
);

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    messageId: text("message_id").notNull(),
    rating: feedbackRatingEnum("rating").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_feedback_tenant_idx").on(t.tenantId)],
);

// ── AI assistant usage metering (AIA-06/BIL-04, ADR-0027). One row per answered
// question; counts + cost only — NEVER message content (SEC-05). costMicroUsd is
// integer micro-dollars ($10.00 = 10_000_000) so budget math stays integral.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// ── Reference-ID counters (DM-07): per (tenant, entity, year), monotonic. ──
export const refCounters = pgTable(
  "ref_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    entity: refEntityEnum("entity").notNull(),
    year: integer("year").notNull(),
    counter: integer("counter").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.entity, t.year] })],
);

// ── Idempotency keys (API-03): retried upload/job requests never double-process. ──
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    status: idempotencyStatusEnum("status").notNull().default("in_progress"),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_tenant_key_idx").on(t.tenantId, t.key)],
);

// ── Auth attempts (AUT-03/04): sliding-window rate limiting + progressive lockout. ──
// NOT tenant-scoped: login/reset run BEFORE the tenant is known, so throttling keys
// on the identifier (lowercased email) and IP. Server-managed (service role); RLS is
// deny-by-default (no permissive policy) per SEC-01.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(), // lowercased email
    ip: text("ip"),
    // 'login' | 'reset' | 'reset_confirm' | 'change_password' | 'otp' | 'signup' | 'signup_verify'
    // | 'trust_refresh' (WP-SU-14, per-family trusted-device rotation cap)
    // plus two WP-SU-8 notification budgets that are NOT throttles: 'signup_notice', 'signup_alert'
    kind: text("kind").notNull(),
    // WP-SU-9: written `true` by reserve() and stamped with the real outcome by settle(). Only
    // `false` rows feed the AUT-04 lockout ladder, which is why a reservation is neutral-true —
    // a refused request must never be able to lock the account it names.
    success: boolean("success").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("auth_attempts_identifier_idx").on(t.identifier, t.kind, t.createdAt),
    index("auth_attempts_ip_idx").on(t.ip, t.kind, t.createdAt),
    // WP-SU-8: backs the GLOBAL rolling-hour ceiling. Neither index above can serve it —
    // both lead with an attacker-chosen column, which is precisely why a global dimension
    // was needed. Leading with `kind` keeps the scan to one endpoint's rows.
    index("auth_attempts_kind_created_idx").on(t.kind, t.createdAt),
  ],
);

// ── Lockout-notice claims (AUT-04, WP-SU-16): one atomic "who sends it" claim per ──
// (identifier, kind). Both lockout-notify routes decide from a PRE-settle snapshot, so N
// racing wrong-credential requests each think they are the tripping attempt; this table lets
// exactly one WIN the notice per lockout window (a read-then-write budget cannot — CWE-367).
// One row per key, updated in place — so it does NOT grow per-event like the append-only
// auth_attempts. It still accretes one row per DISTINCT identifier that ever locks (slowly: a
// lockout is rare), and that row holds a login email in plaintext, so WP-SU-18 sweeps aged rows
// (notified_at past the claim window + margin) via the WP-SU-13 auth-sibling pruner — the same
// data-minimisation treatment as otp_challenges.identifier. NOT tenant-scoped (login is
// pre-tenant); server-managed (service role); RLS deny-by-default per SEC-01.
//
// PK is a surrogate uuid `id` (WP-SU-18) so the retention sweep reuses batchedDeleteByAge like
// every sibling (its invariant is a single uuid PK). The natural key (identifier, kind) is a
// UNIQUE constraint — still the conflict target claimLockoutNotice's atomic upsert claims on.
export const noticeClaims = pgTable(
  "notice_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(), // lowercased email
    kind: text("kind").notNull(), // 'lockout:login' | 'lockout:otp' — one claim key PER auth surface
    // (never merged: a lock on one surface must not suppress the owner alert for the other)
    notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("notice_claims_identifier_kind_key").on(t.identifier, t.kind)],
);

// ── Password reset tokens (AUT-06): single-use, hashed at rest, 30-min expiry. ──
// Keyed to the auth user id; server-managed (service role), RLS deny-by-default.
// Only the SHA-256 hash is stored — the secret goes out once in the reset email.
export const resetTokens = pgTable(
  "reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reset_tokens_hash_idx").on(t.tokenHash),
    index("reset_tokens_user_idx").on(t.userId),
  ],
);

// ── Signup email-verification tokens (SCP-02/AUT-06): single-use, hashed at rest, ──
// 24-hour expiry. Keyed to the auth user id; server-managed (service role), RLS
// deny-by-default. Only the SHA-256 hash is stored — the secret goes out once in
// the verification email; consuming it activates the account.
export const signupVerifications = pgTable(
  "signup_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // the Supabase auth user id to confirm
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("signup_verifications_hash_idx").on(t.tokenHash),
    index("signup_verifications_user_idx").on(t.userId),
  ],
);

// ── Signup invitation codes (SCP-06): a single-use, 48h code the platform owner
// generates and hands to a prospective admin; required at signup. Hashed at rest
// (only the hash is stored; the plaintext is shown once to the owner). Not
// tenant-scoped (redeemed before any tenant exists); server-managed via the
// service role. Single-use is enforced by a conditional `used_at IS NULL` update.
export const signupCodes = pgTable(
  "signup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Email of the platform owner who generated it (from ADMIN_ALLOWLIST). */
    createdBy: text("created_by").notNull(),
    /** The tenant created when the code was redeemed (audit trail); null until used. */
    usedByTenantId: uuid("used_by_tenant_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("signup_codes_hash_idx").on(t.codeHash)],
);

// ── Partner email-OTP challenges (PTL-01): 6-digit code, hashed at rest. ──
// Not tenant-scoped (issued before the session exists); server-managed, RLS
// deny-by-default. Constant-time verify (AUT-09); attempt_count caps guessing.
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(), // lowercased email
    codeHash: text("code_hash").notNull(),
    pepper: text("pepper").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_challenges_identifier_idx").on(t.identifier, t.createdAt)],
);

// ── ToS / Privacy acceptances (LGL-01): versioned, one row per (user, version). ──
export const tosAcceptances = pgTable(
  "tos_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tos_acceptances_user_version_idx").on(t.userId, t.version)],
);

// ── Trusted devices (AUT-10 / ACC-02): rotating refresh-token families backing the
// "remember this device" skip-OTP flow and the sessions/devices registry. Only the
// token hash is stored; reuse of a rotated token ⇒ revoke the whole family. The
// per-device list + revoke work because these tokens are app-owned. Server-managed.
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id").notNull(),
    partnerId: uuid("partner_id"),
    tokenHash: text("token_hash").notNull(),
    deviceLabel: text("device_label"),
    ip: text("ip"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    rotatedTo: text("rotated_to"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("trusted_devices_hash_idx").on(t.tokenHash),
    index("trusted_devices_family_idx").on(t.familyId),
    index("trusted_devices_user_idx").on(t.tenantId, t.userId),
  ],
);
