import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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

/** Require the admin (gated by ADMIN_EMAIL); else redirect. */
export async function requireAdmin() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.email?.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()) redirect('/app')
  return user
}

export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase()
}
