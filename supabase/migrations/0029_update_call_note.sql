-- Edit one saved contact note in place (owner request 2026-07-16): the admin
-- Edit button on each contact log replaces the whole note object, matched by
-- its `at` timestamp (RPC-generated millisecond ISO, unique per note — the
-- same keying admin_delete_call_note and admin_set_note_check already rely
-- on). The replacement object is built in code with the original `at`
-- preserved and `edited_at` stamped. Swapping only the matching element keeps
-- the write atomic per note: a concurrent append or edit to a DIFFERENT note
-- can never be clobbered by an array-level read-modify-write.

create or replace function admin_update_call_note(vid uuid, note_at text, note_data jsonb)
returns void
language sql
as $$
  update verifications
  set call_notes = (
        select jsonb_agg(
          case when n->>'at' = note_at
               then note_data
               else n end)
          from jsonb_array_elements(call_notes) n
      )
  where id = vid
    and call_notes is not null
    and jsonb_array_length(call_notes) > 0;
$$;

revoke execute on function admin_update_call_note(uuid, text, jsonb) from public;
revoke execute on function admin_update_call_note(uuid, text, jsonb) from anon;
revoke execute on function admin_update_call_note(uuid, text, jsonb) from authenticated;
grant execute on function admin_update_call_note(uuid, text, jsonb) to service_role;
