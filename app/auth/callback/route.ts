import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/auth-helpers'

/**
 * Magic-link landing. Two supported flows:
 *  - `?code=…` (PKCE): links requested from the login page in the same browser.
 *  - `?token_hash=…&type=…`: links minted via the admin generateLink API, which
 *    have no PKCE verifier; verified directly server-side.
 * Then route by role: admin → /admin, everyone else → /app (or ?next=).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = url.searchParams.get('next')

  const supabase = await createClient()
  let authed = false

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authed = !error
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    authed = !error
  }

  if (authed) {
    const { data: { user } } = await supabase.auth.getUser()
    const dest = next || (isAdminEmail(user?.email) ? '/admin' : '/app')
    return NextResponse.redirect(new URL(dest, url.origin))
  }

  return NextResponse.redirect(new URL('/login?error=link', url.origin))
}
