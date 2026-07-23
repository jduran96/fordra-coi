-- Drop the orphaned verification-level contact_check column (added 0019).
-- Superseded by the per-note contact_check field (0023 moved the data into
-- note elements) and the contact_checks registry (0028). No code or view
-- reads it; the couple of remaining non-null values are pre-0023 leftovers
-- already migrated into notes. Sibling contact_check_public fell in 0024.
alter table verifications drop column if exists contact_check;
