-- 0022: partner reference prefix JV- -> PR- (owner decision, 2026-07-15; T5 note #7).
-- One-way data rename: PR-<same number> preserves ordering and the (tenant_id, ref_id)
-- uniqueness 1:1. New partners are minted as PR-### by formatPartnerRef;
-- nextPartnerNumber still parses legacy JV- refs so un-migrated environments cannot
-- mint a colliding number. audit_log.entity_ref history keeps JV- (append-only, F-05) —
-- the activity trail is evidence of what was true at the time, never rewritten.
-- (No schema change: no new index/RLS/seed needed; the existing unique index is 1:1-safe.)
UPDATE partners SET ref_id = 'PR-' || substring(ref_id from 4) WHERE ref_id LIKE 'JV-%';
