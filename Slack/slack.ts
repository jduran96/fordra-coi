/**
 * Slack plumbing: request signature verification, Web API wrapper, file
 * download, and the HMAC-signed install-link state that gatekeeps who can
 * install the app (see Slack/README.md).
 */
import { createHmac, timingSafeEqual } from 'crypto'

const SIGNATURE_VERSION = 'v0'
const SIGNATURE_MAX_AGE_S = 60 * 5

export function slackEnv() {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!clientId || !clientSecret || !signingSecret) {
    throw new Error('Missing SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET')
  }
  return { clientId, clientSecret, signingSecret }
}

/** Verify Slack's X-Slack-Signature over the raw request body. */
export function verifySlackSignature(rawBody: string, headers: Headers): boolean {
  const ts = headers.get('x-slack-request-timestamp')
  const sig = headers.get('x-slack-signature')
  if (!ts || !sig) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > SIGNATURE_MAX_AGE_S) return false
  const base = `${SIGNATURE_VERSION}:${ts}:${rawBody}`
  const expected = `${SIGNATURE_VERSION}=` +
    createHmac('sha256', slackEnv().signingSecret).update(base).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

/** Minimal Slack Web API call (form-encoded for oauth, JSON otherwise). */
export async function slackApi(
  method: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as Record<string, unknown>
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
  return data
}

export async function postMessage(token: string, channel: string, text: string, threadTs?: string) {
  return slackApi('chat.postMessage', { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }, token)
}

/** Exchange an OAuth code for a bot token (oauth.v2.access wants form encoding). */
export async function oauthAccess(code: string, redirectUri: string) {
  const { clientId, clientSecret } = slackEnv()
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  })
  const data = await res.json() as {
    ok: boolean; error?: string
    access_token?: string; bot_user_id?: string
    team?: { id: string; name?: string }
    authed_user?: { id?: string }
  }
  if (!data.ok || !data.access_token || !data.team?.id || !data.bot_user_id) {
    throw new Error(`Slack OAuth exchange failed: ${data.error ?? 'missing fields'}`)
  }
  return data
}

/** Download a Slack-hosted file (url_private_download) with the bot token. */
export async function downloadSlackFile(botToken: string, url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  // The URL comes from the (signature-verified) event payload; still, never
  // send the bot token anywhere but Slack itself.
  const host = new URL(url).hostname
  if (host !== 'slack.com' && !host.endsWith('.slack.com')) {
    throw new Error(`Refusing to download from non-Slack host: ${host}`)
  }
  const res = await fetch(url, { headers: { authorization: `Bearer ${botToken}` } })
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`)
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const bytes = await res.arrayBuffer()
  // Slack returns an HTML login page instead of 401 when auth fails.
  if (contentType.includes('text/html')) throw new Error('Slack file download returned HTML (bad token or file access)')
  return { bytes, contentType }
}

// ---- Install-link state (the whitelist gate) --------------------------------
// `state` = base64url(`${orgId}.${expMs}`) + '.' + hex HMAC, signed with
// SESSION_SECRET (same trust anchor as the demo gate). The OAuth callback
// rejects installs without a valid, unexpired state, so only links generated
// from /admin can ever connect a workspace.

function installSecret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set')
  return s
}

export function signInstallState(orgId: string, ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const payload = Buffer.from(`${orgId}.${Date.now() + ttlMs}`).toString('base64url')
  const sig = createHmac('sha256', installSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyInstallState(state: string): { orgId: string } | null {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', installSecret()).update(payload).digest('hex')
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }
  const decoded = Buffer.from(payload, 'base64url').toString('utf8')
  const idx = decoded.lastIndexOf('.')
  if (idx === -1) return null
  const orgId = decoded.slice(0, idx)
  const exp = Number(decoded.slice(idx + 1))
  if (!orgId || !Number.isFinite(exp) || Date.now() > exp) return null
  return { orgId }
}

export const BOT_SCOPES = ['im:history', 'chat:write', 'files:read', 'users:read'] as const

export function installRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  return `${base}/api/slack/oauth/callback`
}
