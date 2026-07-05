-- Seed a "Fordra Testing" org so it is selectable in the admin Users page.
-- Idempotent: only inserts if an org with that name does not already exist.
insert into public.orgs (name)
select 'Fordra Testing'
where not exists (select 1 from public.orgs where name = 'Fordra Testing');
