-- Self-serve insurance-standards templates (Dakota pilot).
-- Each org saves named requirement sets ("Trucking standard", "Construction
-- equipment") with optional {token} variables resolved per deal (e.g. physical
-- damage limit = asset sale price). Customers manage their own templates from
-- /app/settings; verifications record which template they used. Idempotent.

create table if not exists requirement_templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  -- Requirement[] rows: { coverage_type, minimum_limit, notes }. minimum_limit
  -- and notes may contain {tokens} matching a key in `variables`.
  requirements jsonb not null default '[]'::jsonb,
  -- TemplateVariable[]: { key, label, type: 'currency'|'text', required }
  variables    jsonb not null default '[]'::jsonb,
  is_default   boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_req_templates_org on requirement_templates(org_id);
-- One default per org.
create unique index if not exists idx_req_templates_one_default
  on requirement_templates(org_id) where is_default;

alter table requirement_templates enable row level security;

-- Customers manage their own org's templates (self-serve); admin sees all.
drop policy if exists req_templates_own_org on requirement_templates;
create policy req_templates_own_org on requirement_templates for all
  using (org_id = current_org()) with check (org_id = current_org());
drop policy if exists req_templates_admin_all on requirement_templates;
create policy req_templates_admin_all on requirement_templates for all
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on requirement_templates to authenticated;

-- Provenance: which template a verification was created from.
alter table verifications add column if not exists template_id uuid references requirement_templates(id) on delete set null;

-- The customer-facing view + column grants gate verifications columns; template_id
-- is safe to expose (it is the org's own template reference).
grant select (template_id), insert (template_id) on verifications to authenticated;

notify pgrst, 'reload schema';
