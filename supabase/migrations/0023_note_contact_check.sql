-- Per-log contact verification (owner spec 2026-07-16): each insurer contact
-- log carries its own web check of the phone/email cited in THAT entry
-- (numbers and emails can change between calls). The check result lives
-- inside the note element as `contact_check`, so the existing publish gating
-- on call_notes covers it with no view change. This RPC sets/replaces the
-- check on one note (matched by its `at` timestamp) as a single atomic
-- UPDATE, same pattern as admin_append_contact_note (0022).
--
-- The verification-level contact_check_public column (0022) is superseded by
-- this and no longer read anywhere; drop it (and the old
-- admin_append_call_note RPC from 0016) in a later cleanup migration once
-- prod is fully on the new code.

create or replace function admin_set_note_check(vid uuid, note_at text, check_data jsonb)
returns void
language sql
as $$
  update verifications
  set call_notes = (
        select jsonb_agg(
          case when e->>'at' = note_at
               then jsonb_set(e, '{contact_check}', check_data)
               else e end)
          from jsonb_array_elements(call_notes) e
      )
  where id = vid
    and call_notes is not null
    and jsonb_array_length(call_notes) > 0;
$$;

revoke execute on function admin_set_note_check(uuid, text, jsonb) from public;
revoke execute on function admin_set_note_check(uuid, text, jsonb) from anon;
revoke execute on function admin_set_note_check(uuid, text, jsonb) from authenticated;
grant execute on function admin_set_note_check(uuid, text, jsonb) to service_role;
