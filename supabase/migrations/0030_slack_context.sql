-- Where a Slack-submitted verification came from, so publish can notify the submitter.
-- shape: { team_id, channel_id, user_id }
-- Service-role only: NO grant to authenticated (admin reads use the service client;
-- customers never need it). No my_verifications view change.
alter table verifications add column if not exists slack_context jsonb;
