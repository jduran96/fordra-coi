import { randomBytes, createHash } from 'crypto'

export type KeyMode = 'sandbox' | 'live'

/** Generate a new API key. The full secret is shown to the user exactly once. */
export function generateApiKey(mode: KeyMode) {
  const rand = randomBytes(24).toString('base64url')
  const secret = `sk_${mode === 'live' ? 'live' : 'test'}_${rand}`
  return { secret, prefix: secret.slice(0, 13), hash: hashApiKey(secret), mode }
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function keyModeFromSecret(secret: string): KeyMode | null {
  if (secret.startsWith('sk_live_')) return 'live'
  if (secret.startsWith('sk_test_')) return 'sandbox'
  return null
}
