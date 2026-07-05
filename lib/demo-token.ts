/**
 * Demo password-gate token, shared by lib/auth.ts and proxy.ts.
 * Pure Web Crypto, no Next imports, so it runs in the proxy runtime too.
 *
 * Token = `<sigHex>.fordra-auth.<issuedAtMs>`; the HMAC signature covers the
 * timestamped payload, and verification enforces the 24h expiry.
 */

export const SESSION_COOKIE = 'fordra-session'
const PAYLOAD_PREFIX = 'fordra-auth'
/** Demo sessions hard-expire 24h after the password was entered. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

export async function signToken(secret: string): Promise<string> {
  const payload = `${PAYLOAD_PREFIX}.${Date.now()}`
  const key = await hmacKey(secret, 'sign')
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `${sigHex}.${payload}`
}

export async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const dotIdx = token.indexOf('.')
    if (dotIdx === -1) return false
    const sigHex = token.slice(0, dotIdx)
    const payload = token.slice(dotIdx + 1)
    if (!payload.startsWith(`${PAYLOAD_PREFIX}.`)) return false
    const issuedAt = Number(payload.slice(PAYLOAD_PREFIX.length + 1))
    if (!Number.isFinite(issuedAt)) return false
    if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false
    const key = await hmacKey(secret, 'verify')
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  } catch {
    return false
  }
}
