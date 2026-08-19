-- WP-NF1 D1: index the notification bell's two reads, both of which are (tenant_id, user_id)-
-- scoped through ownerWhere (lib/scope.ts) and never by user_id alone:
--   • listNotifications  — mine + ORDER BY created_at DESC LIMIT 30  (notifications.ts:58-64)
--   • unreadCount        — mine + read_at IS NULL, COUNT(*)          (notifications.ts:76-81)
-- The composite carries the sort column, so the list is a bounded backwards index scan rather
-- than a scan-then-sort of everything a user has ever been sent; the partial keeps the badge
-- count proportional to the unread minority, not to the archive.
--
-- DM-13: plain (non-CONCURRENTLY) CREATE INDEX, so it runs inside the migrate transaction.
-- Safe HERE for the same reason as 0051/0052 (C-36): `notifications` is tiny in prod today, so
-- the ShareLock is sub-millisecond — placed now, while it is small, precisely so it is already
-- in place before end-user volume arrives (which we cannot predict). If this table is ever
-- large at migrate time, the deferred out-of-transaction CONCURRENTLY path is the alternative.
--
-- DROP: `notifications_user_idx` (user_id alone) is superseded — every read path filters
-- tenant AND user, so a user-only index was never the one the planner wanted. It was, however,
-- also the users.id FK cover. Acceptable because users are hard-deleted only PRE-ACTIVATION
-- (deprovisionAdmin, dev/test cleanup — src/lib/auth/provision.ts; signup-sweep, abandoned
-- never-verified signups — src/modules/retention/signup-sweep.ts): neither path can have
-- produced a notification row, since every createNotification call site requires an active
-- pipeline/task on a verified tenant. Active seats are deactivated, never deleted (Phase C).
-- Called out for audit-data in the PR body rather than buried here.
DROP INDEX "notifications_user_idx";--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_unread_idx" ON "notifications" USING btree ("tenant_id","user_id") WHERE "notifications"."read_at" is null;
