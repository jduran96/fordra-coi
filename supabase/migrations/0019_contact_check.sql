-- Insurance agent contact check: web-search verification of the producer/agent
-- contact details printed on the COI (design partner: the listed agent isn't
-- always legit). Written by the extraction pipeline, read on the admin detail
-- page only. No grant to `authenticated` on purpose: like the other analysis
-- columns, customers must not read it (admin reads use the service client).
alter table verifications add column if not exists contact_check jsonb;
