import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
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
    refId: text("ref_id").notNull(), // JV-### (DM-07)
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    color: text("color").notNull(), // locked hex (PRN-06)
    dealTerms: text("deal_terms"),
    adminNotes: text("admin_notes"),
    status: partnerStatusEnum("status").notNull().default("not_invited"),
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
  (t) => [uniqueIndex("state_rules_tenant_state_idx").on(t.tenantId, t.state)],
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
    mlsStatus: mlsStatusEnum("mls_status").notNull().default("kept"),
    mlsReason: text("mls_reason"),
    mlsPatternKey: text("mls_pattern_key"),
    mlsMatchSpan: jsonb("mls_match_span"), // {start,end,text} (MLS-05)
    previouslyMatched: boolean("previously_matched").notNull().default(false),
    originalPartnerId: uuid("original_partner_id").references(() => partners.id),
    firstMatchedAt: timestamp("first_matched_at", { withTimezone: true }),
    possibleMlsListing: possibleMlsEnum("possible_mls_listing").notNull().default("pending"),
    // Manual-assignment overlay (ADM / ASN-03). ADDITIVE — the snapshot columns
    // (partnerId / matchMethod) are NEVER rewritten (PRN-05: history is immutable).
    // The "effective" owner is manualPartnerId ?? partnerId, derived in the read
    // layer; only currently-unmatched leads may be manually assigned.
    manualPartnerId: uuid("manual_partner_id").references(() => partners.id),
    manualAssignedAt: timestamp("manual_assigned_at", { withTimezone: true }),
    manualAssignedBy: uuid("manual_assigned_by"),
    manualReason: text("manual_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete (DM-09)
    // WP-GL-B: stamped when the retention sweep redacts this soft-deleted lead's seller PII
    // (DM-09 hard-delete-via-retention / LGL-02 grace). NULL = not yet purged; the sweep's
    // idempotency + selectivity both key off it. PII lives on until then (DM-02 for live leads).
    piiPurgedAt: timestamp("pii_purged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Partial (DM-09 / WP-J2): voiding soft-deletes a run's leads; a corrected re-upload must be
    // able to re-insert the same dedupe_key, so uniqueness applies only to live (non-deleted) rows.
    uniqueIndex("leads_tenant_dedupe_idx").on(t.tenantId, t.dedupeKey).where(sql`${t.deletedAt} is null`),
    index("leads_tenant_upload_idx").on(t.tenantId, t.uploadId),
    index("leads_tenant_partner_created_idx").on(t.tenantId, t.partnerId, t.createdAt),
    index("leads_tenant_manual_partner_idx").on(t.tenantId, t.manualPartnerId),
    // Leads-list query indexes (F-09): the global admin list filters/sorts by these.
    index("leads_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("leads_tenant_state_idx").on(t.tenantId, t.state),
    index("leads_tenant_campaign_idx").on(t.tenantId, t.campaign),
    // WP-GL-B: the retention sweep scans only soft-deleted-not-yet-purged rows — a small set —
    // so a partial index keyed on exactly that predicate keeps the sweep cheap at any table size.
    index("leads_pii_purge_idx")
      .on(t.tenantId, t.deletedAt)
      .where(sql`${t.piiPurgedAt} is null and ${t.deletedAt} is not null`),
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
  (t) => [index("lead_notes_lead_idx").on(t.leadId)],
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
  (t) => [index("lead_status_lead_idx").on(t.leadId)],
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
  (t) => [index("listing_checks_lead_idx").on(t.leadId)],
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
  (t) => [index("notifications_user_idx").on(t.userId)],
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
    kind: text("kind").notNull(), // 'login' | 'reset' | 'change_password'
    success: boolean("success").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("auth_attempts_identifier_idx").on(t.identifier, t.kind, t.createdAt),
    index("auth_attempts_ip_idx").on(t.ip, t.kind, t.createdAt),
  ],
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
