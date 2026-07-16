-- Insurer contact notes (formerly "call notes"). Certifications sometimes
-- happen over email (design partner, 2026-07-16), so a note now records HOW
-- contact happened (contact_method) and splits the body into an optional
-- rich-text summary and an optional plain transcript.
--
-- History note: this migration briefly added a verification-level
-- contact_check_public column + view exposure. Same-day owner respec moved
-- contact verification INTO each note (see 0023), which rides through the
-- existing call_notes gating; 0024 drops the orphaned column.

-- Append RPC for the new note shape:
-- { at, contact_method?, summary_html?, summary_text?, transcript?, contact }
-- Same atomic single-UPDATE pattern as admin_append_call_note (0016).
-- NEW function name on purpose: prod shares this database and its live
-- saveCallNote still calls admin_append_call_note(uuid,text,jsonb) until
-- the new code deploys. Drop the old function in a cleanup migration only
-- after the prod deploy is verified.
create or replace function admin_append_contact_note(
  vid uuid,
  contact_method text,
  summary_html text,
  summary_text text,
  transcript text,
  contact jsonb
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
          -- same as 0016.
          'contact', coalesce(contact, insurance_contact)
        ))
      )
  where id = vid;
$$;

revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb) from public;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb) from anon;
revoke execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb) from authenticated;
grant execute on function admin_append_contact_note(uuid, text, text, text, text, jsonb) to service_role;

-- admin_delete_call_note is untouched: it deletes by the note's `at` and is
-- shape-agnostic.
