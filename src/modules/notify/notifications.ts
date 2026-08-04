import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { type ScopeContext } from "@/lib/scope";

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
  });
}

/** Scope: notifications for THIS user in THIS tenant (never anyone else's). */
function mine(scope: ScopeContext) {
  return and(eq(schema.notifications.tenantId, scope.tenantId), eq(schema.notifications.userId, scope.userId));
}

export async function listNotifications(scope: ScopeContext, limit = 30): Promise<NotificationRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.notifications)
    .where(mine(scope))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    deepLink: n.deepLink,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));
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
