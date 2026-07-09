import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { signToken, SESSION_COOKIE } from '@/lib/auth'

// Hash both sides so lengths match, then compare in constant time.
function passwordMatches(candidate: string, expected: string | undefined): boolean {
  if (!candidate || !expected) return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const { password } = await req.json()

  if (!passwordMatches(String(password ?? ''), process.env.APP_PASSWORD)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = await signToken(process.env.SESSION_SECRET!)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
  return response
}
