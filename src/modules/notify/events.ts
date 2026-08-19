import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere, type ScopeContext } from "@/lib/scope";
import { env } from "@/lib/env";
import { logError } from "@/lib/observability";
import { createNotification } from "./notifications";
import { activeAdminSeats, enqueueEmail, notificationEmailHtml } from "./outbox";
import { loadNotificationPrefs, streamPrefRole, type NotifEvent, type NotifRole } from "./prefs";
import { loadOverridesFor, resolveEffectiveChannel, type PrefOverrideValue } from "./pref-overrides";
import { subjectUnsubscribeLinks } from "./unsubscribe";

// ─────────────────────────────────────────────────────────────────────────────
// WP-NF2 NTF-11 — the four new notification types, and only those. They live here rather
// than in outbox.ts because outbox.ts already carries the run-digest fan-out, the drain loop
// and the release cron; four more emit sites would have made it the module everything in
// notify eventually lands in. The shared machinery it DOES own (enqueueEmail, the admin-tier
// recipient set, the one-paragraph email shell) is imported, never re-implemented.
//
// Every function here is BEST-EFFORT by contract: the caller invokes it AFTER its own write
// has committed, and `bestEffort` swallows anything that goes wrong into an id-only log line.
// A notification is a side channel — it must never be able to fail, or roll back, the thing it
// is reporting on. (PR A's review learned the sharper half of this: minting/enqueueing INSIDE
// the writing transaction also puts a round trip under whatever lock that transaction holds.)
//
// NTF-16 payload hygiene is BINDING in this file:
//  • No task title and no note body ever reaches a title, body, email or log line — those are
//    free text a human typed on a lead, i.e. seller PII (SEC-05, the C-13 lesson). The four
//    bodies below are fixed generic sentences with no interpolation from user content.
//  • Lead-scoped rows carry `leadRef` so a void/purge can redact them (C-13).
//  • A filename IS operator data and is allowed (an admin named their own file); it is the one
//    caller-supplied string this module renders, and nothing from a file's CONTENTS ever is.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/**
 * The scope `loadNotificationPrefs` needs. Prefs are ONE tenant settings row, so the read uses
 * `tenantWhere` and nothing else — the same system-scope idiom `releaseDueImports` and
 * `remindDueTasks` already build for background work. Stated once here so no emit site has to
 * invent a plausible-looking userId of its own.
 */
const prefsScope = (tenantId: string): ScopeContext => ({ tenantId, role: "admin", userId: tenantId });

/**
 * Run one emit, swallowing everything. `ids` are ids and refs ONLY (SEC-05); the error message
 * is the exception's own text, which is the same class of value every other best-effort emit
 * site in the module logs.
 */
async function bestEffort(event: string, ids: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logError(event, { ...ids, message: e instanceof Error ? e.message : String(e) });
  }
}

/** One notification, in the shape both fan-outs below render. */
interface NotificationEmit {
  /** Catalog key — the preference row this emit is gated on. */
  event: NotifEvent;
  /** `notifications.type`, and the outbox `kind`. Equal to `event` for all four new types. */
  type: string;
  title: string;
  /** A FIXED generic sentence. Never user-authored content (NTF-16). */
  body: string;
  deepLink: string;
  /** C-13: set for lead-scoped types only (an aggregate has nothing single to redact by). */
  leadRef?: string;
  meta?: Record<string, string>;
}

/** The in-app leg. */
async function writeBellRow(db: DB, tenantId: string, userId: string, emit: NotificationEmit): Promise<void> {
  await createNotification(db, {
    tenantId,
    userId,
    type: emit.type,
    title: emit.title,
    body: emit.body,
    deepLink: emit.deepLink,
    ...(emit.leadRef ? { leadRef: emit.leadRef } : {}),
  });
}

/** The email leg, with this recipient's own NTF-14 footer. */
async function enqueueSeatEmail(
  db: DB,
  tenantId: string,
  seat: { id: string; address: string },
  role: NotifRole,
  emit: NotificationEmit,
): Promise<void> {
  await enqueueEmail(db, {
    tenantId,
    to: seat.address,
    subject: emit.title,
    body: `${emit.title}. ${emit.body}`,
    html: notificationEmailHtml(
      emit.title,
      emit.body,
      // NTF-14: the SEAT's own token, so the footer this recipient clicks unsubscribes THEM.
      // `env.APP_URL` is the canonical origin — never a request origin (a capability link must
      // not be mintable against a host a caller chose).
      await subjectUnsubscribeLinks(db, tenantId, { userId: seat.id }, { baseUrl: env.APP_URL, role, event: emit.event }),
    ),
    kind: emit.type,
    ...(emit.meta ? { meta: emit.meta } : {}),
  });
}

// ── task_assigned ────────────────────────────────────────────────────────────

/**
 * The stream-appropriate lead URL for a recipient. The ASSIGNEE's stream decides, not the
 * actor's: an admin assigning a task to a partner seat must not send that partner into the
 * admin app, and vice versa. Encoded for defence in depth (the notifyStatusChange convention)
 * even though a lead ref is format-constrained. PURE.
 *
 * The parameter is named `stream`, not `role`, because that is what it is: a `NotifRole` is the
 * binary PRN-13 stream (the pref bucket), already collapsed from the four-value `users.role` by
 * `streamPrefRole` — so member and viewer seats correctly take the admin arm here. Naming it
 * `role` would both misdescribe it and read to AUTHZ-04's chokepoint as the very
 * scope-role-literal comparison that ban exists to prevent.
 */
export function leadDeepLinkFor(stream: NotifRole, leadRef: string): string {
  return stream === "partner"
    ? `/portal/leads/${encodeURIComponent(leadRef)}`
    : `/leads?open=${encodeURIComponent(leadRef)}`;
}

/**
 * NTF-11 `task_assigned`: tell the assignee a task on a lead is now theirs.
 *
 * Called from `addLeadTask` / `editLeadTask` AFTER the task transaction commits, and only when
 * the caller has already established that the SERVER-RESOLVED assignee is neither the actor nor
 * the previous assignee (PRN-08a — the id comes from `resolveAssignee`, never from the request).
 * Those two gates live at the call site because only it holds the before/after pair; everything
 * that depends on the RECIPIENT lives here.
 *
 * The seat is re-read (tenant-pinned, active) for its ROLE and EMAIL: the preference bucket is
 * `streamPrefRole(assignee.role)` — the assignee's own stream, which is what decides both which
 * catalog row gates this and which app the deep link points at.
 *
 * SEC-05/NTF-16: the task TITLE is never sent. It is free text typed on a lead and can carry
 * seller PII, so the body is a fixed sentence and the lead REF is the only identifying value.
 */
export async function notifyTaskAssigned(
  db: DB,
  tenantId: string,
  input: { leadRef: string; assigneeUserId: string },
): Promise<void> {
  await bestEffort("task_assigned_notify_failed", { tenantId, assigneeUserId: input.assigneeUserId }, async () => {
    const [seat] = await db
      .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
      .from(schema.users)
      // A deactivated seat is refused a session, so it is refused a notification (F-7).
      // `resolveAssignee` already refuses to assign to one; this re-states the rule at the
      // recipient boundary, where every other emit in the module states it.
      .where(
        and(
          tenantIdWhere(schema.users, tenantId),
          eq(schema.users.id, input.assigneeUserId),
          isNull(schema.users.deactivatedAt),
        ),
      );
    if (!seat) return;

    const role = streamPrefRole(seat.role);
    const emit: NotificationEmit = {
      event: "task_assigned",
      type: "task_assigned",
      title: `You were assigned a task on lead ${input.leadRef}`,
      body: "A task on this lead is now assigned to you.",
      deepLink: leadDeepLinkFor(role, input.leadRef),
      leadRef: input.leadRef, // C-13: correlate for void/purge redaction
      meta: { leadRef: input.leadRef },
    };

    const prefs = await loadNotificationPrefs(db, prefsScope(tenantId));
    const overlay = (await loadOverridesFor(db, tenantId, [seat.id])).get(seat.id) ?? null;
    const channel = resolveEffectiveChannel(prefs, overlay, role, "task_assigned");
    if (channel.inApp) await writeBellRow(db, tenantId, seat.id, emit);
    const address = seat.email.trim().toLowerCase();
    if (channel.email && address !== "") {
      await enqueueSeatEmail(db, tenantId, { id: seat.id, address }, role, emit);
    }
  });
}

// ── the three admin-TIER ops types ───────────────────────────────────────────

/**
 * Fan one ops notification out to the tenant's ACTIVE admin-TIER seats (WP-NF2 §10.4).
 *
 * `excludeUserIds` exists for exactly one case — `import_result` success skips the acting
 * admin, whose signal is the `run_summary` they already get. Shared-mailbox handling matches
 * `notifyStatusChange`: two seats behind one address receive ONE email (the first seat's, per
 * `activeAdminSeats`' deterministic order) but TWO bell rows, because a bell row belongs to a
 * seat and an inbox belongs to an address.
 *
 * NTF-10: ONE prefs read and ONE overlay read for the whole fan-out, not one per recipient.
 */
async function fanOutToAdmins(
  db: DB,
  tenantId: string,
  emit: NotificationEmit,
  excludeUserIds: readonly string[] = [],
): Promise<void> {
  const excluded = new Set(excludeUserIds);
  const seats = (await activeAdminSeats(db, tenantId)).filter((s) => !excluded.has(s.id));
  if (seats.length === 0) return;
  const prefs = await loadNotificationPrefs(db, prefsScope(tenantId));
  const overrides: Map<string, PrefOverrideValue> = await loadOverridesFor(db, tenantId, seats.map((s) => s.id));

  const sentTo = new Set<string>();
  for (const seat of seats) {
    const channel = resolveEffectiveChannel(prefs, overrides.get(seat.id) ?? null, "admin", emit.event);
    if (channel.inApp) await writeBellRow(db, tenantId, seat.id, emit);
    if (!channel.email) continue;
    const address = seat.email.trim().toLowerCase();
    if (address === "" || sentTo.has(address)) continue;
    sentTo.add(address);
    await enqueueSeatEmail(db, tenantId, { id: seat.id, address }, "admin", emit);
  }
}

/**
 * NTF-11 `partner_note`: a PARTNER wrote a note on a lead — tell the admins.
 *
 * PRN-13, and the whole reason this is one-directional: the emit fires only for the partner →
 * admin direction. An ADMIN note emits NOTHING (a partner is never told an admin wrote a note,
 * and never will be — the two streams are mutually invisible), and the note BODY never appears
 * in the title, the body, the email or a log line. The caller decides the direction from
 * `streamOf(scope)`; this function is only ever reached for the partner side.
 */
export async function notifyPartnerNote(db: DB, tenantId: string, input: { leadRef: string }): Promise<void> {
  await bestEffort("partner_note_notify_failed", { tenantId, leadRef: input.leadRef }, () =>
    fanOutToAdmins(db, tenantId, {
      event: "partner_note",
      type: "partner_note",
      title: `New partner note on lead ${input.leadRef}`,
      // NTF-16/PRN-13: generic. The note text stays behind the stream wall, where a reader has
      // to open the lead — and be entitled to it — to see anything at all.
      body: "A partner added a note to this lead.",
      deepLink: `/leads?open=${encodeURIComponent(input.leadRef)}`,
      leadRef: input.leadRef, // C-13
      meta: { leadRef: input.leadRef },
    }),
  );
}

/** The failure classes an import can end in (WP-NF2 §0 — `upload_status` has no `failed`
 *  value, so these are REQUEST outcomes, not stored states). */
export type ImportFailureClass = "missing_required" | "unrecognized" | "process_failed";

/** A short human phrase per failure class. PURE, and unit-pinned so the notification copy
 *  cannot drift from the ING-08 vocabulary the upload screen uses. */
export function importFailurePhrase(failure: ImportFailureClass): string {
  if (failure === "missing_required") return "required columns are missing";
  if (failure === "unrecognized") return "the file format wasn't recognised";
  return "processing failed";
}

/**
 * NTF-11 `import_result` (SUCCESS): an upload finished processing.
 *
 * Emitted INSIDE `runUpload`'s `withDbIdempotency` block, so an idempotent replay of the same
 * upload key returns the stored response without re-notifying — the same replay-safety the run
 * itself has.
 *
 * `actorUserId` is EXCLUDED (§10.2): the admin who ran the import already gets the
 * `run_summary` bell row from the same code path, and two rows about one upload in one bell is
 * noise, not redundancy.
 */
export async function notifyImportProcessed(
  db: DB,
  tenantId: string,
  input: { uploadRef: string; actorUserId: string },
): Promise<void> {
  await bestEffort("import_result_notify_failed", { tenantId, uploadRef: input.uploadRef }, () =>
    fanOutToAdmins(
      db,
      tenantId,
      {
        event: "import_result",
        type: "import_result",
        title: `Import ${input.uploadRef} processed`,
        body: "An upload finished processing. Open the import to see what it distributed.",
        deepLink: `/imports/${encodeURIComponent(input.uploadRef)}`,
        // No leadRef: an import spans many leads, so there is nothing single to redact by (C-13).
        meta: { uploadRef: input.uploadRef },
      },
      [input.actorUserId],
    ),
  );
}

/**
 * NTF-11 `import_result` (FAILURE): an upload was refused or blew up.
 *
 * Emitted from the uploads ROUTE, because two of the three failure classes are decided before
 * `runUpload` is ever called (ING-08 detection is pre-row) and the third is the route's own 500
 * catch. Recipients INCLUDE the acting admin (§10.2): unlike success there is no `run_summary`
 * covering them, and today a failed import is a toast that vanishes with the tab — this is the
 * durable record of it, which is the ING-08 loud-failure pairing.
 *
 * ⚠️ Deliberate, owner-flagged (§10.2): repeated failed attempts EACH notify. Re-uploading a
 * broken file five times produces five rows. That is loud by design — a quietly-swallowed
 * second failure is the exact shape ING-08 exists to prevent — but it is the one behaviour in
 * this file an owner may want throttled later.
 */
export async function notifyImportFailed(
  db: DB,
  tenantId: string,
  input: { filename: string; failure: ImportFailureClass },
): Promise<void> {
  await bestEffort("import_result_notify_failed", { tenantId, failure: input.failure }, () =>
    fanOutToAdmins(db, tenantId, {
      event: "import_result",
      type: "import_result",
      // The filename is operator data (SEC-05: an admin named their own file — no seller owns
      // it), so it is safe to render. The file's CONTENTS never appear.
      title: `Import failed: ${input.filename} — ${importFailurePhrase(input.failure)}`,
      body: "An upload could not be processed. Open Upload to see the details and try again.",
      deepLink: "/upload",
      meta: { failure: input.failure },
    }),
  );
}

/**
 * NTF-11 `partner_activated`: a partner accepted their invite and went `invited → active`.
 *
 * Fires ONCE, ever. The guarantee is not a check here but at the call site: `tos/accept`'s
 * promotion UPDATE is conditional on `status = 'invited'` and now `.returning()`s, so a
 * re-acceptance updates zero rows and never reaches this function. Same claim-by-conditional-
 * write pattern the task-reminder one-shot uses.
 *
 * PRN-14: the title pairs the partner's NAME with their REF ID — identity is never carried by
 * a colour swatch alone, and a name on its own is not unique.
 */
export async function notifyPartnerActivated(db: DB, tenantId: string, input: { partnerId: string }): Promise<void> {
  await bestEffort("partner_activated_notify_failed", { tenantId, partnerId: input.partnerId }, async () => {
    const [partner] = await db
      .select({ name: schema.partners.name, refId: schema.partners.refId })
      .from(schema.partners)
      // PRN-08: tenant-pinned. A partner id alone is not a scope, even coming from the
      // caller's own session.
      .where(and(tenantIdWhere(schema.partners, tenantId), eq(schema.partners.id, input.partnerId)));
    if (!partner) return;
    await fanOutToAdmins(db, tenantId, {
      event: "partner_activated",
      type: "partner_activated",
      title: `${partner.name} (${partner.refId}) accepted their invite`,
      body: "Onboarding is complete — this partner is now active and can receive leads.",
      deepLink: `/partners/${encodeURIComponent(input.partnerId)}`,
      meta: { partnerRef: partner.refId },
    });
  });
}
