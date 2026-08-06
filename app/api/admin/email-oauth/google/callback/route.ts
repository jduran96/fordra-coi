import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { adminInitials } from '@/lib/admin-activity'
import { encryptSecret } from '@/lib/email-crypto'
import { exchangeCode, fetchGmailProfile, OAUTH_STATE_COOKIE } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

/**
 * Gmail OAuth return leg: verify the state cookie, exchange the code, read
 * the mailbox's canonical address, and upsert the org's email_accounts row
 * (one mailbox per org; reconnecting replaces). Every failure lands back on
 * the settings tab with a readable ?error= — never a dead end.
 */
export async function GET(req: NextRequest) {
  const settingsUrl = (error?: string) => new URL(
    `/admin/settings?tab=emails${error ? `&error=${encodeURIComponent(error)}` : ''}`,
    req.nextUrl.origin,
  )
  const fail = (error: string) => {
    const res = NextResponse.redirect(settingsUrl(error))
    res.cookies.delete(OAUTH_STATE_COOKIE)
    return res
  }

  const admin = await requireAdminApi()
  if (!admin) return NextResponse.redirect(new URL('/admin/login', req.nextUrl.origin))

  const stateParam = req.nextUrl.searchParams.get('state')
  const code = req.nextUrl.searchParams.get('code')
  const googleError = req.nextUrl.searchParams.get('error')
  if (googleError) return fail(`Google refused the connection: ${googleError}`)

  let saved: { nonce?: string; orgId?: string } = {}
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '{}')
  } catch { /* handled below */ }
  if (!saved.nonce || !saved.orgId || saved.nonce !== stateParam) {
    return fail('The connect flow expired or did not match. Try Connect again.')
  }
  if (!code) return fail('Google returned no authorization code.')

  try {
    const token = await exchangeCode(code)
    if (!token.refresh_token) {
      return fail("Google returned no refresh token. Remove Fordra from the Google account's third-party access list and connect again.")
    }
    const profile = await fetchGmailProfile(token.access_token)
    const svc = createServiceClient()
    const { error } = await svc.from('email_accounts').upsert({
      org_id: saved.orgId,
      provider: 'gmail',
      email_address: profile.emailAddress,
      display_name: null,
      refresh_token_enc: encryptSecret(token.refresh_token),
      access_token_enc: encryptSecret(token.access_token),
      access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: token.scope ?? null,
      status: 'connected',
      error: null,
      connected_by: adminInitials(admin.email ?? ''),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })
    if (error) return fail(`Could not save the connected mailbox: ${error.message}`)
  } catch (e) {
    // Token values never appear in these messages (lib/gmail.ts contract).
    return fail(e instanceof Error ? e.message : 'The connection failed.')
  }

  const res = NextResponse.redirect(settingsUrl())
  res.cookies.delete(OAUTH_STATE_COOKIE)
  return res
}
