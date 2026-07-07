-- RLS for idempotency_keys (SEC-01): tenant isolation, same as the other
-- tenant-scoped tables. Idempotency records are server-managed (service role).
alter table idempotency_keys enable row level security;

create policy idempotency_keys_scope on idempotency_keys for all
  using (tenant_id = app_current_tenant())
  with check (tenant_id = app_current_tenant());
