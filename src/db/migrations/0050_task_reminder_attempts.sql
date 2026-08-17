-- C-14 / WP-TSK-6a: an orphaned due-task reminder (no eligible recipient) was re-probed on
-- every 5-min cron tick FOREVER. Count the attempts so the sweep can RETIRE it after N ticks
-- (REMINDER_ATTEMPTS_MAX) and surface it to an admin, instead of re-probing forever + starving the
-- 60s cron. ADD COLUMN with a constant default = no table rewrite (PG11+), no index, no lock issue.
ALTER TABLE "lead_tasks" ADD COLUMN "reminder_attempts" integer DEFAULT 0 NOT NULL;
