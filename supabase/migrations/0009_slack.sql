-- Slack intake integration: workspace installs, DM conversation state, event dedup.
-- All three tables are service-role only (RLS enabled, no policies): the Slack
-- routes run with createServiceClient() and nothing browser-facing reads them.

create table if not exists slack_installations (
  id uuid primary key default gen_random_uuid(),
  team_id text not null unique,
  team_name text,
  org_id uuid not null references orgs(id),
  -- Bot token stored plaintext for v1; table is service-role only. Encrypt if
  -- this ever becomes readable by anything but the server.
  bot_token text not null,
  bot_user_id text not null,
  installed_by_slack_user text,
  -- Null = anyone in the workspace may use the bot; otherwise a whitelist of
  -- Slack user IDs (e.g. U0123ABC) allowed to create verifications.
  allowed_slack_users text[],
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists slack_intake_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  channel_id text not null,
  org_id uuid not null references orgs(id),
  -- Collected slots: { step, carrier_name, requirements_text, files: [{kind, storage_path, file_name, mime_type, size_bytes}] }
  state jsonb not null default '{}'::jsonb,
  verification_id uuid references verifications(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (team_id, channel_id)
);

create table if not exists slack_events_seen (
  event_id text primary key,
  created_at timestamptz not null default now()
);

alter table slack_installations enable row level security;
alter table slack_intake_sessions enable row level security;
alter table slack_events_seen enable row level security;
