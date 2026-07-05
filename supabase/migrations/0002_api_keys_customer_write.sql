-- Allow customers to create/rotate API keys for their own org (read policy
-- already exists from 0001; admin_all already covers admin). Idempotent.

drop policy if exists api_keys_insert_own_org on api_keys;
create policy api_keys_insert_own_org on api_keys for insert
  with check (org_id = current_org());

drop policy if exists api_keys_update_own_org on api_keys;
create policy api_keys_update_own_org on api_keys for update
  using (org_id = current_org()) with check (org_id = current_org());
