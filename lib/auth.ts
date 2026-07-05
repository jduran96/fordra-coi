import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, verifyToken } from '@/lib/demo-token'

export { SESSION_COOKIE, SESSION_MAX_AGE_MS, signToken, verifyToken } from '@/lib/demo-token'

export async function getSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? ''
  const secret = process.env.SESSION_SECRET ?? ''
  if (!secret || !token) return false
  return verifyToken(token, secret)
}

export async function requireAuth(): Promise<NextResponse | null> {
  const authed = await getSession()
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
