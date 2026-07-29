-- Auto-fired first OCR + online contact check (2026-07-28): when a
-- verification is created, lib/auto-checks.ts runs extraction and then the
-- contact check exactly once each. Each claim column is set by ONE atomic
-- conditional UPDATE (WHERE <col> IS NULL RETURNING id); a set value means
-- the auto run was CLAIMED, not that it succeeded. Claims are NEVER reset:
-- a failed auto run is retried only via the admin Rerun buttons, so at most
-- one auto attempt of each check can ever start per verification.
-- Service-role only — verifications gating is column-level, so a new column
-- carries no authenticated grant unless one is added here (none is).

alter table verifications add column if not exists auto_ocr_claimed_at timestamptz;
alter table verifications add column if not exists auto_contact_claimed_at timestamptz;

notify pgrst, 'reload schema';
