-- Internal admin organization flag: lets an admin mark who called / left a
-- voicemail on a request (JD or EM). Purely internal bookkeeping, set and
-- read only via the service-role client from /admin — never granted to
-- `authenticated` and never added to my_verifications, so it can't reach the
-- customer app or the /v1 API.
alter table verifications add column if not exists internal_flag text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'verifications_internal_flag_check'
  ) then
    alter table verifications add constraint verifications_internal_flag_check
      check (internal_flag is null or internal_flag in ('called_jd', 'called_em', 'voicemail_jd', 'voicemail_em'));
  end if;
end $$;
