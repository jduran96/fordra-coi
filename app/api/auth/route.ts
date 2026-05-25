import { NextResponse } from 'next/server'
import { signToken, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: Request) {
  const { password } = await req.json()

  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = await signToken(process.env.SESSION_SECRET!)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  return response
}
