import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isAdminEmail } from '@/lib/admin-emails'
import { DEV_ADMIN_BYPASS, devBypassEmail } from '@/lib/dev-bypass'

export { isAdminEmail }

/**
 * Stand-in session user for the local-only bypass (see lib/dev-bypass.ts).
 * NonNullable matters: requireAdmin's callers rely on a non-null user (every
 * other exit is a `redirect()`, which is `never`), so a `User | null` here
 * would make `admin.email` a type error across the admin actions.
 */
function devUser(): NonNullable<Awaited<ReturnType<typeof getSessionUser>>> {
  return { id: '00000000-0000-0000-0000-000000000000', email: devBypassEmail() } as
    NonNullable<Awaited<ReturnType<typeof getSessionUser>>>
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'customer' | 'admin'
  org_id: string | null
}

/** The authenticated Supabase user, or null. Revalidates the JWT. */
export async function getSessionUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/** Require a signed-in user; otherwise redirect to login. */
export async function requireUser() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

/** The current user's profile row (role + org_id), or null. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, org_id')
    .eq('id', user.id)
    .single()
  return data as Profile | null
}

/** Require an admin (gated by the ADMIN_EMAIL allowlist); else show the error page. */
export async function requireAdmin() {
  if (DEV_ADMIN_BYPASS) return devUser()
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  if (!isAdminEmail(user.email)) redirect('/access-denied')
  return user
}

/**
 * Admin gate for API route handlers (fetch callers): returns the user or
 * null instead of redirecting, so routes can answer 401 JSON. Same checks as
 * requireAdmin: revalidated Supabase JWT + ADMIN_EMAIL allowlist.
 */
export async function requireAdminApi() {
  if (DEV_ADMIN_BYPASS) return devUser()
  const user = await getSessionUser()
  if (!user || !isAdminEmail(user.email)) return null
  return user
}
