-- The /v1 API accepts an auto_call flag (opt-in agent call; always false for the
-- human-review pilot). Add the column and reload the PostgREST schema cache.

alter table verifications add column if not exists auto_call boolean not null default false;

notify pgrst, 'reload schema';
