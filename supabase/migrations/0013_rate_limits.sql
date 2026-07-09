-- Fixed-window rate limiting shared across serverless instances.
-- Only the service role touches this: RLS on with no policies (deny by
-- default), and the RPC is revoked from the PostgREST-exposed roles.

create table if not exists app_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

alter table app_rate_limits enable row level security;

-- Returns true while the caller is within `p_limit` hits per window.
create or replace function rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into app_rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else rl.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke execute on function rate_limit_hit(text, integer, integer) from public;
revoke execute on function rate_limit_hit(text, integer, integer) from anon;
revoke execute on function rate_limit_hit(text, integer, integer) from authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;
