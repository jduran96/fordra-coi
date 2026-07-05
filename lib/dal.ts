import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifyToken } from '@/lib/demo-token'

export async function verifySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? ''
  const secret = process.env.SESSION_SECRET ?? ''
  if (!token || !secret || !(await verifyToken(token, secret))) {
    redirect('/demo/login')
  }
}
