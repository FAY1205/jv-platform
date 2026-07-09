import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { env, isProduction } from "@/lib/env";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";
import { sendEmail, type EmailTransport } from "./email";
import { DevMailboxTransport } from "./dev-mailbox";
import { ResendTransport } from "./resend";
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
  if (isProduction && env.RESEND_API_KEY) return new ResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new DevMailboxTransport();
}

export interface EnqueueEmailInput {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
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
    kind: input.kind,
    status: "pending",
    meta: input.meta ?? null,
  });
}

export interface EnqueueRunDigestsInput {
  uploadRef: string;
  summary: RunSummary;
  /** Absolute origin for building the partner portal link. */
  portalBaseUrl: string;
  /** Admin recipients for the run-summary email (NTF-02). */
  adminEmails: string[];
  /** The acting admin's user id — target for their in-app run notification (NTF-04). */
  adminUserId?: string;
  /** When provided, gates email vs in-app per role/event (NTF-05); absent = email all (028a). */
  prefs?: NotificationPrefs;
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
  const [upload] = await db
    .select({ id: schema.uploads.id })
    .from(schema.uploads)
    .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, input.uploadRef)));
  if (!upload) return 0;

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
    })
    .from(schema.leads)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.leads.partnerId))
    .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.uploadId, upload.id), eq(schema.leads.mlsStatus, "kept")))
    .orderBy(asc(schema.leads.refId));

  interface Group {
    partnerId: string;
    name: string;
    email: string | null;
    ref: string;
    leads: PartnerDigestLead[];
  }
  const byPartner = new Map<string, Group>();
  for (const r of rows) {
    if (!r.partnerId) continue;
    const g = byPartner.get(r.partnerId) ?? { partnerId: r.partnerId, name: r.pName, email: r.pEmail, ref: r.pRef, leads: [] };
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

  const emailOn = (role: "admin" | "partner", ev: "run_summary" | "status_change" | "new_leads") =>
    !input.prefs || resolvePref(input.prefs, role, ev).email;
  const inAppOn = (role: "admin" | "partner", ev: "run_summary" | "status_change" | "new_leads") =>
    !!input.prefs && resolvePref(input.prefs, role, ev).inApp;

  let enqueued = 0;
  for (const g of byPartner.values()) {
    if (g.leads.length === 0) continue;
    const c = buildPartnerDigest({
      appName: APP_NAME,
      partnerName: g.name,
      portalUrl: `${input.portalBaseUrl}/portal`,
      uploadRef: input.uploadRef,
      leads: g.leads,
    });
    // NTF-01: email a partner with an address, when their digest email is on.
    if (g.email && emailOn("partner", "new_leads")) {
      await enqueueEmail(db, {
        tenantId: scope.tenantId,
        to: g.email,
        subject: c.subject,
        body: c.body,
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

  // NTF-02/04: admin run summary — email (default on) + in-app for the acting admin.
  const summary = buildAdminRunSummary({ appName: APP_NAME, uploadRef: input.uploadRef, summary: input.summary });
  if (emailOn("admin", "run_summary")) {
    for (const email of dedupe(input.adminEmails)) {
      await enqueueEmail(db, {
        tenantId: scope.tenantId,
        to: email,
        subject: summary.subject,
        body: summary.body,
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
      title: summary.subject,
      body: `${input.summary.kept} delivered · ${input.summary.removed} removed · ${input.summary.unmatched} unmatched.`,
      deepLink: `/imports/${input.uploadRef}`,
    });
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
        deepLink: `/leads/${input.leadRef}`,
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
        kind: "status_change",
        meta: { leadRef: input.leadRef },
      });
    }
  }
}

export interface DrainResult {
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Drain pending outbox rows whose backoff has elapsed. Sends through the seam
 * (Resend in prod / dev mailbox otherwise); marks sent, or schedules a retry with
 * backoff, or gives up after MAX_OUTBOX_ATTEMPTS. Scoped to `tenantId` when given.
 */
export async function drainOutbox(
  db: DB,
  opts: { tenantId?: string; transport?: EmailTransport; now?: Date; limit?: number } = {},
): Promise<DrainResult> {
  const transport = opts.transport ?? resolveOutboxTransport();
  const now = opts.now ?? new Date();
  const due = and(
    eq(schema.emailOutbox.status, "pending"),
    or(isNull(schema.emailOutbox.nextAttemptAt), lte(schema.emailOutbox.nextAttemptAt, now)),
    opts.tenantId ? eq(schema.emailOutbox.tenantId, opts.tenantId) : undefined,
  );
  const rows = await db.select().from(schema.emailOutbox).where(due).limit(opts.limit ?? 100);

  const result: DrainResult = { sent: 0, failed: 0, retried: 0 };
  for (const row of rows) {
    try {
      const { id } = await sendEmail(
        { to: row.toAddress, subject: row.subject, text: row.body, meta: { kind: row.kind } },
        transport,
      );
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
