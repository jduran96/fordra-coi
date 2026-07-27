-- Rename verifications.carrier_name -> insured_name (owner decision
-- 2026-07-27): the value IS the policyholder, stamped by extraction from the
-- COI's named insured; "carrier" was a factoring-vertical assumption.
--
-- This file is numbered 0007a so the rename runs BEFORE 0008/0027, whose
-- my_verifications definitions now select insured_name (the runner re-applies
-- every file in order on every run, so those files must reference the
-- post-rename name and the rename must precede them). Guarded so re-runs
-- no-op. Column-level grants and indexes survive a rename.
--
-- DEPLOY COUPLING: local and prod share this database. Run db:migrate and
-- deploy the renamed code together; the deployed app breaks between the two.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verifications' and column_name = 'carrier_name'
  ) then
    alter table verifications rename column carrier_name to insured_name;
  end if;
end $$;
