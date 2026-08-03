import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { env, isProduction } from "@/lib/env";
import { releaseCutoff } from "../run/hold-window";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";
import { sendEmail, type EmailTransport } from "./email";
import { resolveEmailTransport } from "./transport";
import { renderEmailDocument, escapeHtml, EMAIL_COLORS, EMAIL_FONTS } from "./email-template";
import { buildPartnerDigest, buildAdminRunSummary, type PartnerDigestLead } from "./digests";
import { createNotification } from "./notifications";
import { resolvePref, loadNotificationPrefs, type NotificationPrefs } from "./prefs";
import type { RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Email outbox (NTF-03): enqueue every digest, then drain through the sendEmail
// seam with delivery status + retry/backoff. Transport is Resend in production
// and the dev mailbox (behind the SEC-07 sink) everywhere else — a real recipient
// can never be reached from dev/preview.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export const MAX_OUTBOX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60_000; // 1 minute
const MAX_BACKOFF_MS = 6 * 60 * 60_000; // 6 hours

/** Exponential backoff for retry number `attempts` (1-based), capped. Pure. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** In production with a key configured, send for real; otherwise capture to the dev mailbox. */
export function resolveOutboxTransport(): EmailTransport {
  return resolveEmailTransport({ isProduction, resendKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM });
}

export interface EnqueueEmailInput {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  kind: string;
  meta?: Record<string, string>;
}

/** Enqueue one pending outbound email. */
export async function enqueueEmail(db: DB, input: EnqueueEmailInput): Promise<void> {
  await db.insert(schema.emailOutbox).values({
    tenantId: input.tenantId,
    toAddress: input.to,
    subject: input.subject,
    body: input.body,
    html: input.html ?? null,
    kind: input.kind,
    status: "pending",
    meta: input.meta ?? null,
  });
}

/** Map a stored outbox row to the email seam (NTF-03). Pure. Sends multipart when html is present. */
export function rowToEmailMessage(row: {
  toAddress: string;
  subject: string;
  body: string;
  html: string | null;
  kind: string;
}) {
  return {
    to: row.toAddress,
    subject: row.subject,
    text: row.body,
    ...(row.html ? { html: row.html } : {}),
    meta: { kind: row.kind },
  };
}

export interface EnqueueRunDigestsInput {
  uploadRef: string;
  /** Required for the admin run-summary (audience "admin"/"all"); unused for "partner". */
  summary?: RunSummary;
  /** Absolute origin for building the partner portal link. */
  portalBaseUrl: string;
  /** Admin recipients for the run-summary email (NTF-02). Unused for audience "partner". */
  adminEmails?: string[];
  /** The acting admin's user id — target for their in-app run notification (NTF-04). */
  adminUserId?: string;
  /** When provided, gates email vs in-app per role/event (NTF-05); absent = email all (028a). */
  prefs?: NotificationPrefs;
  /** Which recipients to notify: "all" (default), "admin" only (at import), "partner" only (at release). */
  audience?: "all" | "admin" | "partner";
}

/**
 * Fan out a run's notifications (NTF-01/02/04/05). Per-partner digests go ONLY to
 * partners who received new leads in this run (newly-inserted leads carry this
 * upload_id). Email is gated by prefs (email on by default); in-app notifications
 * are created for the partner's / admin's user when the in-app channel is on.
 * Returns the number of emails enqueued.
 */
export async function enqueueRunDigests(
  db: DB,
  scope: ScopeContext,
  input: EnqueueRunDigestsInput,
): Promise<number> {
  const audience = input.audience ?? "all";
  const emailOn = (role: "admin" | "partner", ev: "run_summary" | "status_change" | "new_leads") =>
    !input.prefs || resolvePref(input.prefs, role, ev).email;
  const inAppOn = (role: "admin" | "partner", ev: "run_summary" | "status_change" | "new_leads") =>
    !!input.prefs && resolvePref(input.prefs, role, ev).inApp;

  let enqueued = 0;

  // Partner digests (NTF-01/04) — the "distributed to partners" push, deferred to the release cron.
  if (audience !== "admin") {
    const [upload] = await db
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, input.uploadRef)));
    if (upload) {
      // New delivered leads for this run: only newly-inserted leads carry this upload_id.
      const rows = await db
        .select({
          refId: schema.leads.refId,
          city: schema.leads.city,
          state: schema.leads.state,
          partnerId: schema.leads.partnerId,
          pName: schema.partners.name,
          pEmail: schema.partners.email,
          pRef: schema.partners.refId,
          pColor: schema.partners.color,
        })
        .from(schema.leads)
        .innerJoin(schema.partners, eq(schema.partners.id, schema.leads.partnerId))
        // WP-J2: don't digest a recalled lead if a void races this post-run step.
        .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.uploadId, upload.id), eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.deletedAt)))
        .orderBy(asc(schema.leads.refId));

      interface Group {
        partnerId: string;
        name: string;
        email: string | null;
        ref: string;
        color: string;
        leads: PartnerDigestLead[];
      }
      const byPartner = new Map<string, Group>();
      for (const r of rows) {
        if (!r.partnerId) continue;
        const g =
          byPartner.get(r.partnerId) ??
          { partnerId: r.partnerId, name: r.pName, email: r.pEmail, ref: r.pRef, color: r.pColor, leads: [] };
        g.leads.push({ refId: r.refId, city: r.city, state: r.state });
        byPartner.set(r.partnerId, g);
      }

      // Map partner → user id for in-app notifications (a partner may not have onboarded).
      const partnerIds = [...byPartner.keys()];
      const userByPartner = new Map<string, string>();
      if (input.prefs && partnerIds.length > 0) {
        const userRows = await db
          .select({ id: schema.users.id, partnerId: schema.users.partnerId })
          .from(schema.users)
          .where(and(tenantWhere(schema.users, scope), inArray(schema.users.partnerId, partnerIds)));
        for (const u of userRows) if (u.partnerId) userByPartner.set(u.partnerId, u.id);
      }

      for (const g of byPartner.values()) {
        if (g.leads.length === 0) continue;
        const c = buildPartnerDigest({
          appName: APP_NAME,
          partnerName: g.name,
          partnerRef: g.ref,
          portalUrl: `${input.portalBaseUrl}/portal`,
          uploadRef: input.uploadRef,
          leads: g.leads,
          partnerColor: g.color,
        });
        // NTF-01: email a partner with an address, when their digest email is on.
        if (g.email && emailOn("partner", "new_leads")) {
          await enqueueEmail(db, {
            tenantId: scope.tenantId,
            to: g.email,
            subject: c.subject,
            body: c.body,
            html: c.html,
            kind: "partner_digest",
            meta: { uploadRef: input.uploadRef, partnerRef: g.ref },
          });
          enqueued++;
        }
        // NTF-04: in-app notification for onboarded partners, when the in-app channel is on.
        const uid = userByPartner.get(g.partnerId);
        if (uid && inAppOn("partner", "new_leads")) {
          await createNotification(db, {
            tenantId: scope.tenantId,
            userId: uid,
            type: "new_leads",
            title: c.subject,
            body: `${g.leads.length} new lead${g.leads.length === 1 ? "" : "s"} from ${input.uploadRef}.`,
            deepLink: "/portal/leads",
          });
        }
      }
    }
  }

  // Admin run summary (NTF-02/04) — sent at IMPORT with the acting admin + the true full-run summary
  // (NOT deferred: the admin isn't a partner, and a recompute at release undercounts repeat leads).
  if (audience !== "partner" && input.summary) {
    const s = buildAdminRunSummary({
      appName: APP_NAME,
      uploadRef: input.uploadRef,
      summary: input.summary,
      importUrl: `${input.portalBaseUrl}/imports/${input.uploadRef}`,
    });
    if (emailOn("admin", "run_summary")) {
      for (const email of dedupe(input.adminEmails ?? [])) {
        await enqueueEmail(db, {
          tenantId: scope.tenantId,
          to: email,
          subject: s.subject,
          body: s.body,
          html: s.html,
          kind: "admin_run_summary",
          meta: { uploadRef: input.uploadRef },
        });
        enqueued++;
      }
    }
    if (input.adminUserId && inAppOn("admin", "run_summary")) {
      await createNotification(db, {
        tenantId: scope.tenantId,
        userId: input.adminUserId,
        type: "run_summary",
        title: s.subject,
        body: `${input.summary.kept} distributed · ${input.summary.removed} removed · ${input.summary.unmatched} unmatched.`,
        deepLink: `/imports/${input.uploadRef}`,
      });
    }
  }

  return enqueued;
}

function dedupe(emails: string[]): string[] {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Notify admins that a partner changed a lead's status (NTF-02 alert / SET-03).
 * In-app for every admin user (default on); email only if the admin alert email is
 * on (default off). Best-effort — call sites swallow errors.
 */
export async function notifyStatusChange(
  db: DB,
  scope: ScopeContext,
  input: { leadRef: string; status: string },
): Promise<void> {
  const ch = resolvePref(await loadNotificationPrefs(db, scope), "admin", "status_change");
  if (!ch.inApp && !ch.email) return;

  const admins = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.role, "admin")));
  if (admins.length === 0) return;

  const title = `Lead ${input.leadRef} → ${input.status}`;
  if (ch.inApp) {
    for (const a of admins) {
      await createNotification(db, {
        tenantId: scope.tenantId,
        userId: a.id,
        type: "status_change",
        title,
        body: "A partner updated a lead's status.",
        // Open the full leads dialog (status control + history + notes), not the
        // retired read-only /leads/[ref] page — P-1 (portal-parity audit). Encoded for
        // defense-in-depth (pr-review F-3) even though leadRef is format-constrained.
        deepLink: `/leads?open=${encodeURIComponent(input.leadRef)}`,
      });
    }
  }
  if (ch.email) {
    for (const email of dedupe(admins.map((a) => a.email))) {
      await enqueueEmail(db, {
        tenantId: scope.tenantId,
        to: email,
        subject: title,
        body: `A partner updated lead ${input.leadRef} to "${input.status}".`,
        html: renderEmailDocument({
          title,
          preheader: title,
          heading: title,
          contentHtml:
            `<p style="font-family:${EMAIL_FONTS.body};color:${EMAIL_COLORS.text2};font-size:15px">` +
            `A partner updated lead <strong style="color:${EMAIL_COLORS.text}">${escapeHtml(input.leadRef)}</strong> ` +
            `to "${escapeHtml(input.status)}".</p>`,
        }),
        kind: "status_change",
        meta: { leadRef: input.leadRef },
      });
    }
  }
}

/**
 * F-40 / NTF-04 / ADR-0020: tell a partner they've just been given a lead by an admin
 * (manual assign of an unmatched lead, or an edit re-route). In-app for the partner's
 * user, gated on their `new_leads` in-app channel (same signal as distribution).
 * Best-effort — call sites swallow errors. Skipped when the partner has no onboarded
 * user. `scope` is the acting admin's; prefs are per-tenant so this resolves correctly.
 */
export async function notifyLeadAssigned(
  db: DB,
  scope: ScopeContext,
  input: { leadRef: string; partnerId: string },
): Promise<void> {
  if (!resolvePref(await loadNotificationPrefs(db, scope), "partner", "new_leads").inApp) return;
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.partnerId, input.partnerId)));
  if (!user) return;
  await createNotification(db, {
    tenantId: scope.tenantId,
    userId: user.id,
    type: "assigned_lead",
    title: `Lead ${input.leadRef} was assigned to you`,
    body: "An admin routed this lead to you.",
    deepLink: `/portal/leads/${input.leadRef}`,
  });
}

/**
 * S6 bulk assign: ONE summary notification for a batch, not one per lead — a
 * 40-lead backfill must not flood the partner's bell. Same channel gate and
 * best-effort contract as notifyLeadAssigned.
 */
export async function notifyLeadsBulkAssigned(
  db: DB,
  scope: ScopeContext,
  input: { partnerId: string; count: number },
): Promise<void> {
  if (input.count === 0) return;
  if (input.count === 1) return; // single assign keeps the per-lead deep link path
  if (!resolvePref(await loadNotificationPrefs(db, scope), "partner", "new_leads").inApp) return;
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(tenantWhere(schema.users, scope), eq(schema.users.partnerId, input.partnerId)));
  if (!user) return;
  await createNotification(db, {
    tenantId: scope.tenantId,
    userId: user.id,
    type: "assigned_lead",
    title: `${input.count} leads were assigned to you`,
    body: "An admin routed these leads to you.",
    deepLink: "/portal/leads",
  });
}

export interface DrainResult {
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Drain pending outbox rows whose backoff has elapsed. Sends through the seam
 * (Resend in prod / dev mailbox otherwise); marks sent, or schedules a retry with
 * backoff, or gives up after MAX_OUTBOX_ATTEMPTS. Always scoped to `tenantId`.
 */
export async function drainOutbox(
  db: DB,
  opts: { tenantId: string; transport?: EmailTransport; now?: Date; limit?: number },
): Promise<DrainResult> {
  const transport = opts.transport ?? resolveOutboxTransport();
  const now = opts.now ?? new Date();
  // PRN-08 (F-33): a drain is always tenant-scoped — never fan out across tenants.
  const due = and(
    eq(schema.emailOutbox.status, "pending"),
    or(isNull(schema.emailOutbox.nextAttemptAt), lte(schema.emailOutbox.nextAttemptAt, now)),
    eq(schema.emailOutbox.tenantId, opts.tenantId),
  );
  const rows = await db.select().from(schema.emailOutbox).where(due).limit(opts.limit ?? 100);

  const result: DrainResult = { sent: 0, failed: 0, retried: 0 };
  for (const row of rows) {
    try {
      const { id } = await sendEmail(rowToEmailMessage(row), transport);
      await db
        .update(schema.emailOutbox)
        .set({ status: "sent", sentAt: now, providerId: id, attempts: row.attempts + 1, lastError: null })
        .where(eq(schema.emailOutbox.id, row.id));
      result.sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const message = errMessage(e);
      if (attempts >= MAX_OUTBOX_ATTEMPTS) {
        await db
          .update(schema.emailOutbox)
          .set({ status: "failed", attempts, lastError: message })
          .where(eq(schema.emailOutbox.id, row.id));
        result.failed++;
        logError("outbox_send_gave_up", { kind: row.kind, attempts: String(attempts) });
      } else {
        await db
          .update(schema.emailOutbox)
          .set({ attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) })
          .where(eq(schema.emailOutbox.id, row.id));
        result.retried++;
      }
    }
  }
  return result;
}

/** Pending outbox rows for a tenant (admin visibility / debugging). */
export async function pendingOutboxCount(db: DB, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.emailOutbox.id })
    .from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.tenantId, tenantId), inArray(schema.emailOutbox.status, ["pending"])));
  return rows.length;
}

/**
 * Distribution hold: release imports whose 10-min hold window has elapsed. For each processed,
 * not-yet-distributed, not-voided upload past its window, mark it distributed and fan out the
 * PARTNER digests + partner in-app notifications (the admin run-summary already went out at import).
 * Per-upload transaction under the SAME per-tenant advisory lock voidUpload uses, so a void and a
 * release can't interleave; the mark + enqueue commit together, so a push failure rolls back and
 * retries next tick. Partner visibility is computed from the lead's created_at (not this marker), so
 * a stalled release only delays the email, never lead access. Tenant-scoped (PRN-08).
 */
export async function releaseDueImports(
  db: DB,
  opts: { tenantId: string; portalBaseUrl: string; now?: Date; limit?: number },
): Promise<{ released: number }> {
  const now = opts.now ?? new Date();
  const cutoff = releaseCutoff(now);
  const due = await db
    .select({ id: schema.uploads.id, refId: schema.uploads.refId })
    .from(schema.uploads)
    .where(
      and(
        eq(schema.uploads.tenantId, opts.tenantId),
        eq(schema.uploads.status, "processed"),
        isNull(schema.uploads.distributedAt),
        isNull(schema.uploads.voidedAt),
        lt(schema.uploads.createdAt, cutoff), // strict — mirrors releasedLeads()'s partner-visibility gate
      ),
    )
    .orderBy(asc(schema.uploads.createdAt))
    .limit(opts.limit ?? 50);
  if (due.length === 0) return { released: 0 };

  // Partner in-app gating needs the per-tenant prefs; userId is unused (prefs are per-tenant).
  const scope: ScopeContext = { tenantId: opts.tenantId, role: "admin", userId: opts.tenantId };
  const prefs = await loadNotificationPrefs(db, scope);

  let released = 0;
  for (const upload of due) {
    try {
      await db.transaction(async (tx) => {
        // SAME per-tenant lock key as voidUpload/persistRun so a void and a release can't interleave (F-1).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.tenantId})::bigint)`);
        const [fresh] = await tx
          .select({ distributedAt: schema.uploads.distributedAt, voidedAt: schema.uploads.voidedAt })
          .from(schema.uploads)
          .where(eq(schema.uploads.id, upload.id));
        if (!fresh || fresh.distributedAt !== null || fresh.voidedAt !== null) return; // released/voided since select
        await tx
          .update(schema.uploads)
          .set({ distributedAt: now })
          .where(and(eq(schema.uploads.id, upload.id), isNull(schema.uploads.voidedAt)));
        await enqueueRunDigests(tx, scope, { uploadRef: upload.refId, portalBaseUrl: opts.portalBaseUrl, prefs, audience: "partner" });
      });
      released++;
    } catch (e) {
      logError("release_import_failed", { uploadRef: upload.refId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { released };
}
