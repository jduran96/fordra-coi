import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/auth-helpers'

/**
 * Post-password-sign-in landing: the browser client already holds the session;
 * this just routes by role (admin → /admin, else /app) like the magic-link
 * callback does. `next` must be a same-origin relative path.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawNext = url.searchParams.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))

  const dest = next || (isAdminEmail(user.email) ? '/admin' : '/app')
  return NextResponse.redirect(new URL(dest, url.origin))
}
