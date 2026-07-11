-- webhook_endpoints: customers could INSERT/UPDATE arbitrary endpoint URLs
-- directly through the PostgREST surface (policy was FOR ALL), and emitEvent
-- would then POST signed payloads to any URL — an SSRF/exfiltration primitive.
-- There is no self-serve webhook UI yet; endpoints are provisioned by Fordra
-- (service role bypasses RLS). Customers keep read access for debugging.
drop policy if exists webhooks_own_org on webhook_endpoints;
create policy webhooks_own_org on webhook_endpoints for select
  using (org_id = current_org());
