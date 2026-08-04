-- F-05 / DM-04: audit_log is append-only compliance evidence. Reject UPDATE and
-- DELETE at the database so no code path (or compromised app credential) can tamper
-- with or erase the trail. An explicit, session-scoped escape hatch
-- (app.audit_log_purge) is honored ONLY for test teardown and a future, deliberate
-- retention sweep — app code never sets it. Triggers fire for cascade deletes too,
-- which is intentional: nothing may remove an audit row implicitly.
CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_log_purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
