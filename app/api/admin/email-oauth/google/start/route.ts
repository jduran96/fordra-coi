import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { gmailAuthUrl, OAUTH_STATE_COOKIE } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

/**
 * Kick off the Gmail OAuth connect flow for one org's sending mailbox
 * (settings → Emails → Accounts → Connect Gmail). The state nonce + target
 * org ride an HttpOnly cookie the callback checks, so a forged callback
 * cannot attach a mailbox to an org the admin never picked (CSRF).
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get('org_id') ?? ''
  const svc = createServiceClient()
  const { data: org } = await svc.from('orgs').select('id').eq('id', orgId).maybeSingle()
  if (!org) {
    return NextResponse.redirect(new URL('/admin/settings?tab=emails&error=Unknown+org', req.nextUrl.origin))
  }

  const nonce = randomUUID()
  const res = NextResponse.redirect(gmailAuthUrl(nonce))
  res.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ nonce, orgId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/admin/email-oauth',
    maxAge: 600,
  })
  return res
}
