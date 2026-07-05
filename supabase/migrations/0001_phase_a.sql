-- Fordra Phase A — ADDITIVE migration on top of the existing Supabase schema.
--
-- The baseline (orgs, profiles, verifications, documents, my_verifications view,
-- current_org()/is_admin()/handle_new_user()/set_updated_at(), customer RLS) was
-- built via the Supabase dashboard and already lives in the DB. This migration
-- ONLY ADDS the missing Phase A pieces. Fully idempotent — safe to re-run.
--
-- Naming adopts the existing convention: `org`/`org_id`, current_org(), is_admin().

-- ── 1. API keys (machine auth for the /v1 API) ───────────────────────────────
create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  mode         text not null check (mode in ('sandbox','live')),
  key_hash     text not null,                       -- sha-256 of the sk_test_/sk_live_ secret
  key_prefix   text not null,                       -- e.g. 'sk_test_a1b2' for display
  name         text,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_api_keys_hash on api_keys(key_hash) where revoked_at is null;
create index if not exists idx_api_keys_org  on api_keys(org_id);

-- ── 2. Webhook endpoints + event log (partner status delivery) ───────────────
create table if not exists webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  url         text not null,
  events      text[] not null default '{}',
  secret      text not null,                        -- HMAC signing secret
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_webhooks_org on webhook_endpoints(org_id);

create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  type         text not null,                       -- e.g. 'verification.updated'
  data         jsonb,
  delivered_at timestamptz,
  attempts     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_events_org on events(org_id);

-- ── 3. Extraction columns (so the parsed analysis shows in the queue) ────────
-- Per-document parse output, so I can confirm OCR worked on each uploaded file.
alter table documents add column if not exists raw_ocr          jsonb;
alter table documents add column if not exists extracted        jsonb;
alter table documents add column if not exists confidence       jsonb;
alter table documents add column if not exists extractor        text;        -- 'claude' | 'azure_di'
alter table documents add column if not exists extraction_status text not null default 'processing';

-- Normalized requirements (stated + inferred w/ explanation + provenance) on the deal.
alter table verifications add column if not exists requirements_normalized jsonb;

-- ── 4. Admin RLS — is_admin() exists but no policy used it yet ────────────────
-- Admin must see ALL orgs' queues and UPDATE verifications (to work + publish).
-- Permissive policies OR together with the existing customer policies, so this
-- grants the admin full access without loosening customer isolation.
do $$
declare t text;
begin
  foreach t in array array['orgs','profiles','verifications','documents','api_keys','webhook_endpoints','events']
  loop
    execute format('drop policy if exists %1$s_admin_all on %1$s', t);
    execute format($f$create policy %1$s_admin_all on %1$s for all
      using (public.is_admin()) with check (public.is_admin())$f$, t);
  end loop;
end $$;

-- ── 5. Customer RLS for the new org-scoped tables ────────────────────────────
-- api_keys: customer reads own org's keys (display only); writes via admin/portal action.
drop policy if exists api_keys_read_own_org on api_keys;
create policy api_keys_read_own_org on api_keys for select
  using (org_id = current_org());

-- webhook_endpoints: customer manages own org's endpoints.
drop policy if exists webhooks_own_org on webhook_endpoints;
create policy webhooks_own_org on webhook_endpoints for all
  using (org_id = current_org()) with check (org_id = current_org());

-- events: customer reads own org's events (audit/debug).
drop policy if exists events_read_own_org on events;
create policy events_read_own_org on events for select
  using (org_id = current_org());

-- enable RLS on the new tables
alter table api_keys          enable row level security;
alter table webhook_endpoints enable row level security;
alter table events            enable row level security;
