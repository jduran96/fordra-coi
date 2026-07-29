-- Activity feeds query events per verification. The id only existed deep in
-- the emitEvent payload (data->'data'->'object'->>'id'), so it gets a real
-- indexed column; lib/webhooks.ts stamps it on insert from here on.

alter table events add column if not exists verification_id uuid;
create index if not exists idx_events_verification on events(verification_id);

-- Backfill from stored payloads (idempotent; regex-guard the uuid cast).
update events
   set verification_id = (data->'data'->'object'->>'id')::uuid
 where verification_id is null
   and data->'data'->'object'->>'id'
       ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Customers read their org's events through the events_read_own_org RLS
-- policy (0001); make the table grant explicit so the feed never depends on
-- default privileges.
grant select on events to authenticated;
