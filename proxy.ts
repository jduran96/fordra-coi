import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE = 'fordra-session'
const PAYLOAD = 'fordra-auth'

async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const dotIdx = token.indexOf('.')
    if (dotIdx === -1) return false
    const sigHex = token.slice(0, dotIdx)
    const payload = token.slice(dotIdx + 1)
    if (payload !== PAYLOAD) return false
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow password screen and auth endpoint through
  if (pathname === '/' || pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  const secret = process.env.SESSION_SECRET
  if (!secret) {
    return pathname.startsWith('/api/')
      ? Response.json({ error: 'Unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/', request.url))
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? ''
  const valid = await verifyToken(token, secret)

  if (!valid) {
    return pathname.startsWith('/api/')
      ? Response.json({ error: 'Unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
