import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

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

export async function verifySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? ''
  const secret = process.env.SESSION_SECRET ?? ''
  if (!token || !secret || !(await verifyToken(token, secret))) {
    redirect('/')
  }
}
