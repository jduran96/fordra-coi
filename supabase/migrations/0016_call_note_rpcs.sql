-- Call notes were maintained with a JS read-modify-write (read array, push,
-- write back): a transient read failure emptied the array and a concurrent
-- save could drop a note. These RPCs make append and delete single atomic
-- UPDATE statements evaluated on the current row version, so notes can never
-- be lost to a race or a bad read. Service role only (admin console actions),
-- same exposure pattern as rate_limit_hit in 0013.

create or replace function admin_append_call_note(vid uuid, note_text text, contact jsonb)
returns void
language sql
as $$
  update verifications
  set call_notes = coalesce(call_notes, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'text', note_text,
          -- Blank contact form means "snapshot the saved insurer contact",
          -- mirroring the old JS behavior.
          'contact', coalesce(contact, insurance_contact)
        )
      )
  where id = vid;
$$;

-- Deletes by the note's `at` timestamp (ms precision; appends serialize on the
-- row lock, so duplicates cannot occur in practice).
create or replace function admin_delete_call_note(vid uuid, note_at text)
returns void
language sql
as $$
  update verifications
  set call_notes = coalesce(
        (select jsonb_agg(e)
           from jsonb_array_elements(coalesce(call_notes, '[]'::jsonb)) e
          where e->>'at' is distinct from note_at),
        '[]'::jsonb)
  where id = vid;
$$;

revoke execute on function admin_append_call_note(uuid, text, jsonb) from public;
revoke execute on function admin_append_call_note(uuid, text, jsonb) from anon;
revoke execute on function admin_append_call_note(uuid, text, jsonb) from authenticated;
grant execute on function admin_append_call_note(uuid, text, jsonb) to service_role;

revoke execute on function admin_delete_call_note(uuid, text) from public;
revoke execute on function admin_delete_call_note(uuid, text) from anon;
revoke execute on function admin_delete_call_note(uuid, text) from authenticated;
grant execute on function admin_delete_call_note(uuid, text) to service_role;
