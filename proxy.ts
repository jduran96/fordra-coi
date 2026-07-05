import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// ── Demo password gate ────────────────────────────────────────────────────────
// Shared token logic: signed issued-at timestamp, 24h expiry (lib/demo-token.ts).
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, verifyToken as verifyDemoToken } from '@/lib/demo-token'

/**
 * Three auth surfaces, routed here:
 *   - password cookie  → /demo + its /api/* pipeline routes
 *   - Supabase session → /app (customer) and /admin (admin-email gated)
 *   - API key (in-route) → /v1/*  (proxy passes through)
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public: landing chooser, demo password page, magic-link login, auth callback, demo password POST
  if (
    pathname === '/' ||
    pathname === '/demo/login' ||
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next()
  }

  // Machine API — authenticated per-request by API key inside the route handler
  if (pathname.startsWith('/v1/')) {
    return NextResponse.next()
  }

  // Customer portal + admin console — Supabase session
  if (pathname.startsWith('/app') || pathname.startsWith('/admin')) {
    const { response, user } = await updateSession(request)
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
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
      url.pathname = '/login'
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
      const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase()
      if (!adminEmail || user.email?.toLowerCase() !== adminEmail) {
        const url = request.nextUrl.clone()
        url.pathname = '/app'
        return NextResponse.redirect(url)
      }
    }
    return response
  }

  // Demo UI + its pipeline API routes — password cookie
  if (pathname.startsWith('/demo') || pathname.startsWith('/api/')) {
    const secret = process.env.SESSION_SECRET
    const token = request.cookies.get(SESSION_COOKIE)?.value ?? ''
    const valid = secret ? await verifyDemoToken(token, secret) : false
    if (!valid) {
      return pathname.startsWith('/api/')
        ? Response.json({ error: 'Unauthorized' }, { status: 401 })
        : NextResponse.redirect(new URL('/demo/login', request.url))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
