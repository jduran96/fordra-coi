-- Contact log entries carry who made the contact: 'ai' (published AI call)
-- or 'human' (admin-logged). Rides inside the call_notes entry as `agent`;
-- legacy entries have no key and render no tag. Manual logs pick it in the
-- form (default human); AI publishes stamp 'ai'.
--
-- Same overload rule as 0028: drop the old signature first, then recreate
-- with the extra defaulted param so in-flight 7-named-param calls from the
-- not-yet-deployed app keep resolving during the migrate -> deploy window.

drop function if exists admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb);
create or replace function admin_append_contact_note(
  vid uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb,
  check_data jsonb default null,
  agent text default null
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
          'contact_check', check_data,
          'agent', case when agent in ('ai', 'human') then agent end
        ))
      )
  where id = vid;
$$;

revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb, text) from public;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb, text) from anon;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb, text) from authenticated;
grant execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb, jsonb, text) to service_role;

drop function if exists admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb);
create or replace function admin_publish_ai_call_note(
  p_call_id uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb,
  check_data jsonb default null,
  agent text default 'ai'
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
          'contact_check',  check_data,
          'agent', case when agent in ('ai', 'human') then agent end
        ))
      )
  where id = vid;
  update ai_calls set published_note_at = note_at, updated_at = now() where id = p_call_id;
  return note_at;
end;
$$;

revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb, text) from public;
revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb, text) from anon;
revoke execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb, text) from authenticated;
grant execute on function admin_publish_ai_call_note(uuid, text, text, text, text, jsonb, jsonb, text) to service_role;
