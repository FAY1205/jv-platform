import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { ownerWhere, type ScopeContext } from "@/lib/scope";
import { encodeNotificationCursor, type NotificationCursor } from "./feed-cursor";

// ─────────────────────────────────────────────────────────────────────────────
// In-app notification center (NTF-04). Notifications are per USER (a partner's
// user, an admin's user); every read/write is scoped to tenant + the recipient's
// user id, so no user can see another's notifications (PRN-08).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  deepLink?: string;
  /** C-13 / WP-RET-3a: the lead this notification is about (refId), for lead-scoped types
   *  (task_due, status_change, single assigned_lead) so a void/purge can redact it. Omit for
   *  aggregate notifications (hot_leads/run_summary/bulk assigned span many leads). */
  leadRef?: string;
}

/** Insert one in-app notification for a recipient user. */
export async function createNotification(db: DB, input: CreateNotificationInput): Promise<void> {
  await db.insert(schema.notifications).values({
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    deepLink: input.deepLink ?? null,
    leadRef: input.leadRef ?? null,
  });
}

/** Scope: notifications for THIS user in THIS tenant (never anyone else's). The predicate is
 *  the shared per-user builder (audit-tenancy F-3) — this table and `saved_views` had grown
 *  identical hand-rolled copies of the same rule. */
function mine(scope: ScopeContext) {
  return ownerWhere(schema.notifications, schema.notifications.userId, scope);
}

/** FEP-03: the default page the bell (and the first page of /notifications) asks for. */
export const FEED_PAGE_SIZE = 30;
/** FEP-03: the hard server-side ceiling. A page this size still renders unvirtualized
 *  (FRONTEND_STANDARDS' ~200-row threshold), which is why the page needs no windowing. */
export const FEED_PAGE_MAX = 50;

export interface NotificationFeedPage {
  notifications: NotificationRow[];
  /** FEP-03: the token for the NEXT page, or `null` when this page was not full — i.e.
   *  the caller has reached the end of their feed. */
  nextCursor: string | null;
}

export interface ListNotificationsOptions {
  limit?: number;
  /** A DECODED cursor (the route owns the opaque→struct step so a malformed token is a
   *  400 at the boundary, never a silent "start over" here). */
  cursor?: NotificationCursor | null;
}

/**
 * FEP-03 keyset predicate: everything strictly older than the cursor row in the
 * `(created_at DESC, id DESC)` order.
 *
 * A ROW-VALUE comparison, not the hand-expanded `created_at < x OR (created_at = x AND
 * id < y)` — one test the planner can push into the `(tenant_id, user_id, created_at DESC)`
 * index rather than two it has to OR together. The cursor's timestamp is compared at the
 * precision Postgres actually stores (see feed-cursor.ts), so a fan-out's tie group is
 * walked, never skipped.
 */
function afterCursor(cursor: NotificationCursor): SQL {
  return sql`(${schema.notifications.createdAt}, ${schema.notifications.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

/**
 * The caller's own feed, newest first, one keyset page at a time (FEP-03 / NTF-12).
 *
 * The bare call — no cursor, no limit — is byte-for-byte the pre-NF2 read plus the `id`
 * tie-break leg in the ORDER BY, so the bell's contract is unchanged and only gains the
 * additive `nextCursor`.
 */
export async function listNotifications(
  scope: ScopeContext,
  opts: ListNotificationsOptions = {},
): Promise<NotificationFeedPage> {
  // Clamped here as well as Zod-bounded at the route: this module is called directly by
  // server code too, and an unbounded limit is a whole-archive scan.
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? FEED_PAGE_SIZE)), FEED_PAGE_MAX);
  const cursor = opts.cursor ?? null;
  const rows = await getDb()
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      title: schema.notifications.title,
      body: schema.notifications.body,
      deepLink: schema.notifications.deepLink,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
      // The MICROSECOND-precision instant, for the cursor only. postgres-js hands back a JS
      // Date for timestamptz, which has already truncated to milliseconds — round-tripping
      // that into the keyset predicate loses a whole tie group (feed-cursor.ts).
      cursorAt: sql<string>`to_char(${schema.notifications.createdAt} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.notifications)
    // PRN-08: `mine` is the ownerWhere pin; the cursor only ever NARROWS it.
    .where(cursor ? and(mine(scope), afterCursor(cursor)) : mine(scope))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit);

  const notifications: NotificationRow[] = rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    deepLink: n.deepLink,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));
  const last = rows[rows.length - 1];
  return {
    notifications,
    nextCursor:
      rows.length === limit && last ? encodeNotificationCursor({ createdAt: last.cursorAt, id: last.id }) : null,
  };
}

export async function unreadCount(scope: ScopeContext): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(mine(scope), isNull(schema.notifications.readAt)));
  return Number(row?.n ?? 0);
}

/** Mark one notification read (only if it belongs to the caller). */
export async function markRead(scope: ScopeContext, id: string): Promise<void> {
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(mine(scope), eq(schema.notifications.id, id), isNull(schema.notifications.readAt)));
}

export async function markAllRead(scope: ScopeContext): Promise<void> {
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(mine(scope), isNull(schema.notifications.readAt)));
}
