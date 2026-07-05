-- Call notes become an append-only jsonb array of timestamped entries:
--   [{ "at": "2026-07-05T12:00:00Z", "text": "..." }, ...]
-- Previously a bare text column (only ever null in the live DB). Idempotent.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'verifications' and column_name = 'call_notes' and data_type = 'text'
  ) then
    alter table verifications
      alter column call_notes type jsonb
      using case
        when call_notes is null or call_notes = '' then null
        else jsonb_build_array(jsonb_build_object('at', now(), 'text', call_notes))
      end;
  end if;
end $$;
