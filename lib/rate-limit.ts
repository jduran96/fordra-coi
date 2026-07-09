import { createServiceClient } from '@/lib/supabase/server'

/**
 * Fixed-window rate limiter backed by Postgres (app_rate_limits +
 * rate_limit_hit(), migration 0013): serverless instances share no memory, so
 * the counter must live in the database. One RPC per check.
 *
 * Fails OPEN: if the RPC errors, the request proceeds — a limiter outage must
 * not take down submissions. Callers treat `false` as "over the limit".
 */
export async function rateLimitAllows(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const svc = createServiceClient()
  const { data, error } = await svc.rpc('rate_limit_hit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error(`rate_limit_hit failed for ${key}: ${error.message}`)
    return true
  }
  return data === true
}

/** Best-effort caller IP for per-IP keys (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
