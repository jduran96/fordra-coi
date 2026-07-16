-- Drop the short-lived verification-level contact_check_public column (added
-- by 0022's first revision, superseded the same day by per-note checks in
-- 0023 that ride inside call_notes). Nothing reads it; the view stopped
-- exposing it when 0008 (re-runnable drop+create) narrowed the view back.
-- Runs after 0008 in every full re-apply, so the view no longer references
-- the column by the time this drops it.
alter table verifications drop column if exists contact_check_public;
