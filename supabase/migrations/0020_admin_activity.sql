-- Admin activity log: append-only [{ at, kind, by, note }] replacing the
-- single-value internal_flag (which only remembered the LAST action; the log
-- can show "3 voicemails over 3 days"). Admin-only: no grants to
-- `authenticated`, so it never reaches the customer app or /v1. The
-- internal_flag column stays for old rows (the queue falls back to it) but is
-- no longer written.
--
-- Same atomic-append RPC pattern as call notes (0016): append and delete are
-- single UPDATE statements so a race or bad read can never drop entries.
-- Service role only.

alter table verifications add column if not exists admin_activity jsonb;

create or replace function admin_append_activity(vid uuid, kind text, actor text, note text)
returns void
language sql
as $$
  update verifications
  set admin_activity = coalesce(admin_activity, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'kind', kind,
          'by', actor,
          'note', nullif(trim(coalesce(note, '')), '')
        )
      )
  where id = vid;
$$;

-- Deletes by the entry's `at` timestamp (ms precision; appends serialize on
-- the row lock, so duplicates cannot occur in practice).
create or replace function admin_delete_activity(vid uuid, entry_at text)
returns void
language sql
as $$
  update verifications
  set admin_activity = coalesce(
        (select jsonb_agg(e)
           from jsonb_array_elements(coalesce(admin_activity, '[]'::jsonb)) e
          where e->>'at' is distinct from entry_at),
        '[]'::jsonb)
  where id = vid;
$$;

revoke execute on function admin_append_activity(uuid, text, text, text) from public;
revoke execute on function admin_append_activity(uuid, text, text, text) from anon;
revoke execute on function admin_append_activity(uuid, text, text, text) from authenticated;
grant execute on function admin_append_activity(uuid, text, text, text) to service_role;

revoke execute on function admin_delete_activity(uuid, text) from public;
revoke execute on function admin_delete_activity(uuid, text) from anon;
revoke execute on function admin_delete_activity(uuid, text) from authenticated;
grant execute on function admin_delete_activity(uuid, text) to service_role;
