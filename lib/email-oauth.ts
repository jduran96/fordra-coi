import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/email-crypto'
import type { EmailAccountRow } from '@/lib/email-provider'

/**
 * Provider-agnostic OAuth plumbing shared by every email connector
 * (lib/email-connectors.ts): the state cookie both route legs exchange, the
 * redirect URI shape, the token-endpoint POST, and the refresh core. Nothing
 * here knows a specific vendor — the provider modules pass their endpoint and
 * error wording in via RefreshConfig.
 */

/** HttpOnly cookie carrying the OAuth CSRF nonce + target org + provider
 *  between the start and callback routes (app/api/admin/email-oauth/). */
export const OAUTH_STATE_COOKIE = 'fordra-email-oauth-state'

/** Cookie payload; `provider` (the route segment) stops a flow started for
 *  one connector from completing against another's callback. */
export interface OAuthState {
  nonce: string
  orgId: string
  provider: string
}

export function redirectUriFor(segment: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fordra.com'
  return `${base}/api/admin/email-oauth/${segment}/callback`
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

export async function tokenRequest(label: string, url: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10000),
  })
  const text = await res.text()
  if (!res.ok) {
    // Google's and Microsoft's error JSON are both token-free and safe to surface.
    throw new Error(`${label} token endpoint responded ${res.status}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as TokenResponse
}

/** What accessTokenFor needs to know about one vendor's refresh grant. */
export interface RefreshConfig {
  /** 'Google' / 'Microsoft', for error text. */
  label: string
  tokenUrl: string
  params(refreshToken: string): Record<string, string>
  /** The settings-card message when the refresh token is dead. */
  invalidGrantMessage: string
}

/**
 * A live access token for the account: the stored one when still valid,
 * otherwise refreshed and re-persisted (encrypted). A dead refresh token
 * (invalid_grant — revoked, or expired; Microsoft's AADSTS codes ride inside
 * the same error body) flips the account to status 'error' so the settings
 * card shows Reconnect.
 */
export async function accessTokenFor(svc: SupabaseClient, account: EmailAccountRow, cfg: RefreshConfig): Promise<string> {
  const expiresAt = account.access_token_expires_at ? new Date(account.access_token_expires_at).getTime() : 0
  if (account.access_token_enc && expiresAt > Date.now() + 60_000) {
    return decryptSecret(account.access_token_enc)
  }
  let token: TokenResponse
  try {
    token = await tokenRequest(cfg.label, cfg.tokenUrl, cfg.params(decryptSecret(account.refresh_token_enc)))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('invalid_grant')) {
      await svc.from('email_accounts').update({
        status: 'error',
        error: cfg.invalidGrantMessage,
        updated_at: new Date().toISOString(),
      }).eq('id', account.id)
    }
    throw e
  }
  await svc.from('email_accounts').update({
    access_token_enc: encryptSecret(token.access_token),
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    // Microsoft rotates the refresh token on every refresh and retires the old
    // one, so a returned token must replace the stored one or the mailbox
    // strands. Google omits refresh_token here, making this a no-op for Gmail.
    ...(token.refresh_token ? { refresh_token_enc: encryptSecret(token.refresh_token) } : {}),
    status: 'connected',
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id)
  return token.access_token
}
