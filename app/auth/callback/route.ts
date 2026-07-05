import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/auth-helpers'

/**
 * Magic-link landing. Supabase appends `?code=…`; exchange it for a session,
 * then route by role: admin → /admin, everyone else → /app (or ?next=).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      const dest = next || (isAdminEmail(user?.email) ? '/admin' : '/app')
      return NextResponse.redirect(new URL(dest, url.origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=link', url.origin))
}
