-- Review finding on 0020: `now()` is fixed at transaction start with ms
-- precision, so two admins logging in the same millisecond could produce
-- identical `at` values — and admin_delete_activity deletes by `at`, so one
-- delete could silently remove both entries. clock_timestamp() +
-- microsecond precision makes a collision practically impossible.
create or replace function admin_append_activity(vid uuid, kind text, actor text, note text)
returns void
language sql
as $$
  update verifications
  set admin_activity = coalesce(admin_activity, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'kind', kind,
          'by', actor,
          'note', nullif(trim(coalesce(note, '')), '')
        )
      )
  where id = vid;
$$;
