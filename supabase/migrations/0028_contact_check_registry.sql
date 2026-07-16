-- Online contact check registry (owner respec 2026-07-16 evening): ONE
-- manually triggered web check task on the admin Calls tab (prefilled from
-- the COI, values editable) replaces the per-log "Run online check". Every
-- run is APPENDED to verifications.contact_checks as history — nothing is
-- superseded or deleted, so older runs stay visible to the admin. Contact
-- logs inherit their tags by matching cited phone/email against this history
-- in code (newest run wins); the matched snapshot still lives INSIDE each
-- note (contact_check key), so customer visibility keeps riding the existing
-- call_notes publish gating with no view change.
--
-- Like 0019's contact_check, the column gets NO authenticated grant: only the
-- admin's service client reads the registry itself.

alter table verifications add column if not exists contact_checks jsonb;

-- Append one run. Entry shape (built in code):
-- { phone?, email?, phone_status?, email_status?, blurb, sources, checked_at, edited_at? }
create or replace function admin_append_contact_check(vid uuid, entry jsonb)
returns void
language sql
as $$
  update verifications
  set contact_checks = coalesce(contact_checks, '[]'::jsonb) || jsonb_build_array(entry)
  where id = vid;
$$;

revoke execute on function admin_append_contact_check(uuid, jsonb) from public;
revoke execute on function admin_append_contact_check(uuid, jsonb) from anon;
revoke execute on function admin_append_contact_check(uuid, jsonb) from authenticated;
grant execute on function admin_append_contact_check(uuid, jsonb) to service_role;

-- Replace one run after an admin edit (statuses/blurb). Keyed by checked_at,
-- a JS-generated millisecond ISO unique per run — same reasoning as note `at`
-- in admin_set_note_check (0023).
create or replace function admin_set_contact_check(vid uuid, entry_at text, entry_data jsonb)
returns void
language sql
as $$
  update verifications
  set contact_checks = (
        select jsonb_agg(
          case when e->>'checked_at' = entry_at
               then entry_data
               else e end)
          from jsonb_array_elements(contact_checks) e
      )
  where id = vid
    and contact_checks is not null
    and jsonb_array_length(contact_checks) > 0;
$$;

revoke execute on function admin_set_contact_check(uuid, text, jsonb) from public;
revoke execute on function admin_set_contact_check(uuid, text, jsonb) from anon;
revoke execute on function admin_set_contact_check(uuid, text, jsonb) from authenticated;
grant execute on function admin_set_contact_check(uuid, text, jsonb) to service_role;

-- admin_append_contact_note grows an optional 7th param carrying the note's
-- inherited check snapshot, so note + tag land in ONE atomic UPDATE (the RPC
-- generates the note's `at` internally, so a follow-up admin_set_note_check
-- from code could never know which note to target without a racy re-read).
-- The default keeps live prod's 6-named-param calls resolving during the
-- migrate -> deploy window. Drop the 6-arg signature first: an extra
-- overload would make PostgREST named-param resolution ambiguous.
drop function if exists admin_append_contact_note(uuid, text, text, text, text, jsonb);
create or replace function admin_append_contact_note(
  vid uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb,
  check_data jsonb default null
)
returns void
language sql
as $$
  update verifications
  set call_notes = coalesce(call_notes, '[]'::jsonb) || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'contact_method', nullif(trim(coalesce(contact_method, '')), ''),
          'summary_html',   nullif(coalesce(summary_html, ''), ''),
          'summary_text',   nullif(coalesce(summary_text, ''), ''),
          'transcript',     nullif(coalesce(transcript, ''), ''),
          -- Blank contact form means "snapshot the saved insurer contact",
          -- same as 0016/0022.
          'contact', coalesce(contact, insurance_contact),
          -- jsonb_strip_nulls drops the key entirely when no check matched.
          'contact_check', check_data
        ))
      )
  where id = vid;
$$;

revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb) from public;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb) from anon;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb) from authenticated;
grant execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb) to service_role;

-- The old verification-level contact_check column (0019) is orphaned once the
-- new code deploys; drop it (and verifyInsurerContact's stored results) in a
-- later cleanup migration after prod verify, per the 0024/0025 pattern.
