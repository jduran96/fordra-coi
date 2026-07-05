import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client for use in Server Components, Route Handlers, and
 * Server Actions. Reads/writes the auth session via Next's cookie store.
 *
 * Uses the publishable key (sb_publishable_…) as the anon key — RLS enforces
 * tenant isolation, so this key is safe to use with a user session.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: the proxy refreshes the session on navigation.
          }
        },
      },
    },
  )
}

/**
 * Service-role client — bypasses RLS. Use ONLY in trusted server code (the /v1
 * API after resolving partner_id from the API key, webhook delivery, admin jobs).
 * Never expose to the browser. Does not read the user cookie/session.
 */
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  )
}
