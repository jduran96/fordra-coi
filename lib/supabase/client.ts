import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client for Client Components (login UI, customer portal
 * interactions). Uses the publishable key; RLS does the tenant isolation.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
