-- Admin-editable runtime configuration (baseline requirements, OCR prompts).
-- Key/value store; values are jsonb. Read via service client in server code;
-- RLS restricts direct access to the admin. Idempotent.

create table if not exists app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;

drop policy if exists app_config_admin_all on app_config;
create policy app_config_admin_all on app_config for all
  using (public.is_admin()) with check (public.is_admin());
