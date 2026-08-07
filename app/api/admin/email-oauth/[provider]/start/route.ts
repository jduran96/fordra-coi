import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { connectorBySegment } from '@/lib/email-connectors'
import { OAUTH_STATE_COOKIE, type OAuthState } from '@/lib/email-oauth'

export const dynamic = 'force-dynamic'

/**
 * Kick off the OAuth connect flow for one org's sending mailbox (settings →
 * Emails → Accounts → Connect), for whichever vendor the path segment names
 * (lib/email-connectors.ts). The state nonce + target org + provider ride an
 * HttpOnly cookie the callback checks, so a forged callback cannot attach a
 * mailbox to an org (or through a provider) the admin never picked (CSRF).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { provider } = await params
  const connector = connectorBySegment(provider)
  if (!connector) {
    return NextResponse.redirect(new URL('/admin/settings?tab=emails&error=Unknown+email+provider', req.nextUrl.origin))
  }

  const orgId = req.nextUrl.searchParams.get('org_id') ?? ''
  const svc = createServiceClient()
  const { data: org } = await svc.from('orgs').select('id').eq('id', orgId).maybeSingle()
  if (!org) {
    return NextResponse.redirect(new URL('/admin/settings?tab=emails&error=Unknown+org', req.nextUrl.origin))
  }

  const nonce = randomUUID()
  const state: OAuthState = { nonce, orgId, provider }
  const res = NextResponse.redirect(connector.authUrl(nonce))
  res.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/admin/email-oauth',
    maxAge: 600,
  })
  return res
}
