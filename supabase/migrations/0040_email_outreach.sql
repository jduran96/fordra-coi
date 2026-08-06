-- Email verification outreach: admins send verification-question emails from a
-- connected customer-domain mailbox, read replies in Fordra, and publish full
-- threads into the contact log. Mirrors the ai_calls security shape (0032):
-- RLS admin policy, zero grants to PostgREST roles, service client only, so
-- nothing here is customer-visible. Publishing a thread into the customer
-- record goes through call_notes via admin_publish_email_note below, riding
-- the existing publish gating unchanged.

-- Per-org sending identity. One mailbox per org (unique index); reconnecting
-- replaces it. OAuth tokens are AES-256-GCM encrypted app-side with an
-- env-held key before they land here, so a leaked dump/backup does not yield
-- live mailbox credentials on top of the RLS lockdown.
create table if not exists email_accounts (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references orgs(id) on delete cascade,
  provider                text not null,             -- 'gmail' (Microsoft Graph later)
  email_address           text not null,
  display_name            text,
  refresh_token_enc       text not null,
  access_token_enc        text,
  access_token_expires_at timestamptz,
  scopes                  text,
  status                  text not null default 'connected',  -- 'connected' | 'error'
  error                   text,
  connected_by            text not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table email_accounts enable row level security;
drop policy if exists email_accounts_admin_all on email_accounts;
create policy email_accounts_admin_all on email_accounts for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on email_accounts from anon;
revoke all on email_accounts from authenticated;

create unique index if not exists email_accounts_org_idx on email_accounts (org_id);

-- One row per Fordra-initiated outreach thread. The `payload` column is the
-- EXACT send an admin approved — written once at approval, before the provider
-- call, never updated after — the audit artifact next to the eventual thread.
create table if not exists email_threads (
  id                  uuid primary key default gen_random_uuid(),
  verification_id     uuid not null references verifications(id) on delete cascade,
  account_id          uuid references email_accounts(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          text not null,
  -- draft | approved | sent | failed
  status              text not null default 'draft',
  subject             text,
  to_emails           jsonb,         -- string[]
  cc_emails           jsonb,         -- string[]
  body_text           text,
  attachments         jsonb,         -- [{document_id, file_name}] frozen at approval
  draft_input         jsonb,         -- pre-approval form edits; ignored after approval
  payload             jsonb,         -- frozen approved send (the audit artifact)
  approved_by         text,
  approved_at         timestamptz,
  provider            text,
  provider_thread_id  text,          -- Gmail threadId
  provider_message_id text,          -- Gmail id of the initial send
  last_message_at     timestamptz,   -- denorm, recomputed by sync
  last_direction      text,          -- 'outbound' | 'inbound' (inbound = reply awaiting admin)
  message_count       integer not null default 0,
  last_synced_at      timestamptz,
  published_note_at   text,          -- ContactNote.at of the published call_notes entry
  error               text
);

alter table email_threads enable row level security;
drop policy if exists email_threads_admin_all on email_threads;
create policy email_threads_admin_all on email_threads for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on email_threads from anon;
revoke all on email_threads from authenticated;

create index if not exists email_threads_verification_idx on email_threads (verification_id, created_at desc);
create index if not exists email_threads_provider_idx on email_threads (provider_thread_id);
create index if not exists email_threads_created_idx on email_threads (created_at desc);

-- One row per message in a thread, outbound and inbound. Separate table (not
-- jsonb on the thread) so refresh/sync dedupes through the unique index with
-- insert-on-conflict-ignore — race-safe when two admins refresh at once.
create table if not exists email_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references email_threads(id) on delete cascade,
  provider_message_id text not null,
  message_id_header   text,          -- RFC 822 Message-ID, threads our replies
  in_reply_to         text,
  direction           text not null, -- 'outbound' | 'inbound'
  from_email          text,
  from_name           text,
  to_emails           jsonb,         -- string[]
  cc_emails           jsonb,         -- string[]
  subject             text,
  body_text           text,          -- extracted plain text
  attachments         jsonb,         -- [{filename, mime_type, size}] metadata only
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (thread_id, provider_message_id)
);

alter table email_messages enable row level security;
drop policy if exists email_messages_admin_all on email_messages;
create policy email_messages_admin_all on email_messages for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on email_messages from anon;
revoke all on email_messages from authenticated;

create index if not exists email_messages_thread_idx on email_messages (thread_id, sent_at);

-- Publish an email thread's summary + formatted thread text into call_notes
-- AND stamp the email_threads row with the generated note timestamp,
-- atomically. Mirror of admin_publish_ai_call_note (0037 signature) with the
-- lookup on email_threads. The published entry is a plain ContactNote
-- afterward: editable/deletable through the existing note RPCs, and customer
-- visibility rides the existing call_notes publish gating.
create or replace function admin_publish_email_note(
  p_thread_id uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb,
  check_data jsonb default null,
  agent text default 'human'
) returns text
language plpgsql
as $$
declare
  note_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  vid uuid;
begin
  select verification_id into vid from email_threads where id = p_thread_id;
  if vid is null then
    return null;
  end if;
  update verifications
  set call_notes = coalesce(call_notes, '[]'::jsonb) || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'at', note_at,
          'contact_method', nullif(trim(coalesce(contact_method, '')), ''),
          'summary_html',   nullif(coalesce(summary_html, ''), ''),
          'summary_text',   nullif(coalesce(summary_text, ''), ''),
          'transcript',     nullif(coalesce(transcript, ''), ''),
          'contact',        coalesce(contact, insurance_contact),
          'contact_check',  check_data,
          'agent', case when agent in ('ai', 'human') then agent end
        ))
      )
  where id = vid;
  update email_threads set published_note_at = note_at, updated_at = now() where id = p_thread_id;
  return note_at;
end;
$$;

revoke execute on function admin_publish_email_note(uuid, text, text, text, text, jsonb, jsonb, text) from public;
revoke execute on function admin_publish_email_note(uuid, text, text, text, text, jsonb, jsonb, text) from anon;
revoke execute on function admin_publish_email_note(uuid, text, text, text, text, jsonb, jsonb, text) from authenticated;
grant execute on function admin_publish_email_note(uuid, text, text, text, text, jsonb, jsonb, text) to service_role;
