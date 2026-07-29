-- Deal assignment: which admin owns a verification (the admin's email from
-- the ADMIN_EMAIL allowlist). Set from the Assign button on /admin/[id];
-- shown as initials in the review queue and the detail header.
-- Admin bookkeeping only: NO grant to `authenticated` and not part of
-- my_verifications, so customers never see it.

alter table verifications add column if not exists assigned_admin text;
