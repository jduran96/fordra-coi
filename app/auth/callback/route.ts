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
  // `next` arrives as a query param (minted links) or the login-next cookie
  // (login-page flow keeps the email redirect URL query-free so the template
  // can append ?token_hash=...). Parse ONLY login-next, and never let a
  // malformed value throw: decodeURIComponent rejects bad % escapes, and one
  // corrupt cookie anywhere on the domain must not 500 every sign-in.
  const loginNextRaw = (request.headers.get('cookie') ?? '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('login-next='))
    ?.slice('login-next='.length)
  let loginNext: string | null = loginNextRaw ?? null
  try {
    if (loginNextRaw) loginNext = decodeURIComponent(loginNextRaw)
  } catch {
    // keep the raw value; the same-origin check below still applies
  }
  // Only same-origin relative paths: anything absolute ("https://…") or
  // protocol-relative ("//…") would be an open redirect off Fordra.
  const rawNext = url.searchParams.get('next') || loginNext || null
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  const supabase = await createClient()
  let authed = false

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    authed = !error
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authed = !error
  }

  const res = authed
    ? await (async () => {
        const { data: { user } } = await supabase.auth.getUser()
        const dest = next || (isAdminEmail(user?.email) ? '/admin' : '/app')
        return NextResponse.redirect(new URL(dest, url.origin))
      })()
    : NextResponse.redirect(new URL('/login?error=link', url.origin))
  res.cookies.delete('login-next')
  return res
}
