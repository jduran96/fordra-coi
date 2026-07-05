-- The /v1 API creates rows with the service role and no human user:
--  - documents can be uploaded before a verification exists (doc-first), and
--  - API-created verifications have no created_by profile.
-- Portal inserts still set both (enforced by the customer RLS policies). Idempotent.

alter table documents     alter column verification_id drop not null;
alter table verifications alter column created_by      drop not null;
