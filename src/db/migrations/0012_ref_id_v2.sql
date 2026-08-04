-- Reference-ID v2 data migration (ADR-0019). Rewrites stored refs in place, forward-only
-- (no production data — synthetic dev only). Formats:
--   uploads/imports  UP-YYYY-###   -> IM-YY-###
--   leads            LD-YYYY-#####  -> LD-YY-#####
--   partners         JV-###         (unchanged)
-- Also rewrites the refs embedded in audit_log.entity_ref and notifications.deep_link.
-- The regex captures the last two year digits (\1) and drops the 20 prefix.

update uploads
  set ref_id = regexp_replace(ref_id, '^UP-20(\d\d)-', 'IM-\1-')
  where ref_id like 'UP-20%';--> statement-breakpoint
update leads
  set ref_id = regexp_replace(ref_id, '^LD-20(\d\d)-', 'LD-\1-')
  where ref_id like 'LD-20%';--> statement-breakpoint
update audit_log
  set entity_ref = regexp_replace(entity_ref, '^UP-20(\d\d)-', 'IM-\1-')
  where entity_ref like 'UP-20%';--> statement-breakpoint
update audit_log
  set entity_ref = regexp_replace(entity_ref, '^LD-20(\d\d)-', 'LD-\1-')
  where entity_ref like 'LD-20%';--> statement-breakpoint
update notifications
  set deep_link = regexp_replace(deep_link, '/imports/UP-20(\d\d)-', '/imports/IM-\1-')
  where deep_link like '%/imports/UP-20%';--> statement-breakpoint
update notifications
  set deep_link = regexp_replace(deep_link, '/leads/LD-20(\d\d)-', '/leads/LD-\1-')
  where deep_link like '%/leads/LD-20%';--> statement-breakpoint
-- Digest email bodies + subjects embed refs as free text; rewrite them in place so the
-- dev mailbox shows v2 refs without a reseed (all occurrences, hence the 'g' flag).
update email_outbox
  set body = regexp_replace(regexp_replace(body, 'UP-20(\d\d)-', 'IM-\1-', 'g'), 'LD-20(\d\d)-', 'LD-\1-', 'g')
  where body like '%UP-20%' or body like '%LD-20%';--> statement-breakpoint
update email_outbox
  set subject = regexp_replace(regexp_replace(subject, 'UP-20(\d\d)-', 'IM-\1-', 'g'), 'LD-20(\d\d)-', 'LD-\1-', 'g')
  where subject like '%UP-20%' or subject like '%LD-20%';
