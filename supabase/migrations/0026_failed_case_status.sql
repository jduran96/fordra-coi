-- "Failed" replaces "Rejected" (design partner, 2026-07-16): when the insurer
-- can't be reached, the admin marks the verification Failed with a reason the
-- customer sees. The enum value gets its own file because the runner wraps
-- each file in one transaction and a value added by ALTER TYPE can't be used
-- until that transaction commits (0027 backfills with it).
alter type case_status add value if not exists 'failed';
