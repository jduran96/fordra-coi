import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { adminInitials } from '@/lib/admin-activity'
import { encryptSecret } from '@/lib/email-crypto'
import { connectorBySegment } from '@/lib/email-connectors'
import { OAUTH_STATE_COOKIE, type OAuthState } from '@/lib/email-oauth'

export const dynamic = 'force-dynamic'

/**
 * OAuth return leg for whichever vendor the path segment names: verify the
 * state cookie (nonce, org, and that the flow started for THIS provider),
 * exchange the code, read the mailbox's canonical address, and upsert the
 * org's email_accounts row (one mailbox per org; reconnecting replaces, even
 * across providers). Every failure lands back on the settings tab with a
 * readable ?error= — never a dead end.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
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

  const { provider } = await params
  const connector = connectorBySegment(provider)
  if (!connector) return fail('Unknown email provider.')

  const stateParam = req.nextUrl.searchParams.get('state')
  const code = req.nextUrl.searchParams.get('code')
  const vendorError = req.nextUrl.searchParams.get('error')
  if (vendorError) return fail(`${connector.vendor} refused the connection: ${vendorError}`)

  let saved: Partial<OAuthState> = {}
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '{}')
  } catch { /* handled below */ }
  // Pre-provider-field cookies (no `provider`) fail closed, as does a flow
  // started for a different connector.
  if (!saved.nonce || !saved.orgId || saved.nonce !== stateParam || saved.provider !== provider) {
    return fail('The connect flow expired or did not match. Try Connect again.')
  }
  if (!code) return fail(`${connector.vendor} returned no authorization code.`)

  try {
    const token = await connector.exchangeCode(code)
    if (!token.refresh_token) return fail(connector.missingRefreshTokenHelp)
    const profile = await connector.fetchProfile(token.access_token)
    const svc = createServiceClient()
    const { error } = await svc.from('email_accounts').upsert({
      org_id: saved.orgId,
      provider: connector.provider,
      email_address: profile.emailAddress,
      display_name: profile.displayName,
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
    // Token values never appear in these messages (provider module contract).
    return fail(e instanceof Error ? e.message : 'The connection failed.')
  }

  const res = NextResponse.redirect(settingsUrl())
  res.cookies.delete(OAUTH_STATE_COOKIE)
  return res
}
