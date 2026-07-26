-- AI voice-agent dispatch records (voice spec v5 §10): one row per dispatch
-- attempt. The `payload` column is the EXACT dynamic-variable map an admin
-- approved — written once at approval, never updated after — and sits next to
-- the eventual transcript/recording as the audit artifact. Admin/service-role
-- only: RLS admin policy, zero grants to PostgREST roles, no view changes, so
-- nothing here is customer-visible. Publishing a result into the customer
-- record goes through call_notes via admin_publish_ai_call_note below, which
-- rides the existing publish gating unchanged.

create table if not exists ai_calls (
  id                   uuid primary key default gen_random_uuid(),
  verification_id      uuid not null references verifications(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           text not null,
  -- draft | rejected | approved | dispatched | in_progress | completed | stopped | failed
  status               text not null default 'draft',
  to_number            text,
  number_source        text,          -- 'coi' | 'contact_check' | 'manual'
  questions            jsonb,         -- AiCallQuestion[] (editable until approval)
  draft_input          jsonb,         -- pre-approval form edits; ignored after approval
  payload              jsonb,         -- frozen approved variable map (the audit artifact)
  approved_by          text,
  approved_at          timestamptz,
  rejected_reason      text,
  retell_agent_id      text,
  retell_call_id       text,
  call_status          text,          -- raw Retell call_status snapshot
  transcript           text,
  call_analysis        jsonb,         -- Retell call_analysis (call_summary + custom_analysis_data)
  recording_url        text,
  disconnection_reason text,
  started_at           timestamptz,
  ended_at             timestamptz,
  duration_ms          integer,
  stopped_by           text,
  published_note_at    text,          -- ContactNote.at of the published call_notes entry
  error                text
);

alter table ai_calls enable row level security;
drop policy if exists ai_calls_admin_all on ai_calls;
create policy ai_calls_admin_all on ai_calls for all
  using (public.is_admin()) with check (public.is_admin());
-- Belt and braces: PostgREST roles get no grants at all (service client only).
revoke all on ai_calls from anon;
revoke all on ai_calls from authenticated;

create index if not exists ai_calls_verification_idx on ai_calls (verification_id, created_at desc);
create index if not exists ai_calls_retell_idx on ai_calls (retell_call_id);
create index if not exists ai_calls_created_idx on ai_calls (created_at desc);

-- Publish an AI call's summary + transcript into call_notes AND stamp the
-- ai_calls row with the generated note timestamp, atomically. The note `at`
-- is generated here (same format as admin_append_contact_note, 0028) because
-- only the SQL side can know it without a racy re-read; returning it lets the
-- action report which note was created. The published entry is a plain
-- ContactNote afterward: editable/deletable through the existing note RPCs,
-- and customer visibility rides the existing call_notes publish gating.
create or replace function admin_publish_ai_call_note(
  p_call_id uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb,
  check_data jsonb default null
) returns text
language plpgsql
as $$
declare
  note_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  vid uuid;
begin
  select verification_id into vid from ai_calls where id = p_call_id;
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
          'contact_check',  check_data
        ))
      )
  where id = vid;
  update ai_calls set published_note_at = note_at, updated_at = now() where id = p_call_id;
  return note_at;
end;
$$;

revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb) from public;
revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb) from anon;
revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb) from authenticated;
grant execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb) to service_role;
