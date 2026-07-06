-- Allow 'slack' as a verification source (Slack intake, Slack/ folder).
alter table verifications drop constraint verifications_source_check;
alter table verifications add constraint verifications_source_check
  check (source = any (array['web'::text, 'api'::text, 'slack'::text]));
