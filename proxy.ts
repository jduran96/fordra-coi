import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { isAdminEmail } from '@/lib/admin-emails'
import { DEV_ADMIN_BYPASS } from '@/lib/dev-bypass'

/** Sessions hard-expire 24h after the last real sign-in, on every surface. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Two auth surfaces, routed here:
 *   - Supabase session → /app (customer) and /admin (admin-email gated)
 *   - API key (in-route) → /v1/*  (proxy passes through)
 * (The demo password surface was removed 2026-07-23 along with /demo.)
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public: root redirect, customer + admin logins, auth callback
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/admin/login' ||
    pathname.startsWith('/auth/')
  ) {
    return NextResponse.next()
  }

  // Machine API — authenticated per-request by API key inside the route handler
  if (pathname.startsWith('/v1/')) {
    return NextResponse.next()
  }

  // Slack — authenticated in-route (request signature for events, signed
  // install-link state for OAuth); the demo cookie gate must not apply.
  if (pathname.startsWith('/api/slack/')) {
    return NextResponse.next()
  }

  // Admin console API (AI call status polling) — admin session verified
  // in-route (requireAdminApi); this passthrough grants nothing by itself.
  if (pathname.startsWith('/api/admin/')) {
    return NextResponse.next()
  }

  // Retell webhooks — verified in-route by x-retell-signature.
  if (pathname.startsWith('/api/retell/')) {
    return NextResponse.next()
  }

  // Customer portal + admin console — Supabase session. Each surface has its
  // own login page (customer /login offers password sign-in; admin is link-only).
  if (pathname.startsWith('/app') || pathname.startsWith('/admin')) {
    // Local-only console bypass (lib/dev-bypass.ts). Inert unless
    // DEV_ADMIN_BYPASS=1 on a non-production, non-Vercel build; /app is never
    // bypassed, so the customer surface still needs a real session.
    if (DEV_ADMIN_BYPASS && pathname.startsWith('/admin')) {
      return NextResponse.next()
    }
    const loginPath = pathname.startsWith('/admin') ? '/admin/login' : '/login'
    const { response, user } = await updateSession(request)
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = loginPath
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    // Sessions hard-expire 24h after the last magic-link sign-in, mirroring the
    // demo gate. last_sign_in_at only updates on a real sign-in, not on token
    // refresh, so refresh tokens can't keep a session alive forever. Clear the
    // Supabase cookies so the login page starts from a clean slate.
    const signedInAt = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0
    if (!signedInAt || Date.now() - signedInAt > SESSION_MAX_AGE_MS) {
      const url = request.nextUrl.clone()
      url.pathname = loginPath
      url.search = ''
      url.searchParams.set('next', pathname)
      url.searchParams.set('expired', '1')
      const redirect = NextResponse.redirect(url)
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith('sb-')) redirect.cookies.delete(c.name)
      }
      return redirect
    }
    if (pathname.startsWith('/admin')) {
      if (!isAdminEmail(user.email)) {
        const url = request.nextUrl.clone()
        url.pathname = '/access-denied'
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
    return response
  }

  // Any other /api/* path has no handler anymore (the demo pipeline routes
  // were deleted); refuse instead of falling through.
  if (pathname.startsWith('/api/')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
