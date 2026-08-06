import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/email-crypto'
import type { EmailAccountRow, EmailProvider, FetchedMessage, OutgoingEmail, SendResult } from '@/lib/email-provider'
import type { EmailMessageAttachment } from '@/lib/email-shared'

/**
 * Gmail implementation of the email provider (lib/email-provider.ts): OAuth
 * connect + refresh, RFC 2822 MIME building, send, and thread fetch — all raw
 * fetch against the Gmail REST API, matching the repo's no-SDK style
 * (lib/notify.ts does the same for Resend). Tokens live encrypted in
 * email_accounts (lib/email-crypto.ts) and NEVER appear in logs or errors.
 *
 * Scopes are the minimal pair for "send from and read the connected mailbox":
 * gmail.send + gmail.readonly. Both are Google "restricted" scopes — the
 * OAuth consent screen must be published (Testing-mode refresh tokens die
 * after 7 days) and the customer's Workspace admin should trust the client id.
 */

/** HttpOnly cookie carrying the OAuth CSRF nonce + target org between the
 *  start and callback routes (app/api/admin/email-oauth/google/). */
export const OAUTH_STATE_COOKIE = 'fordra-email-oauth-state'

const OAUTH_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1'

function clientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!id) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set')
  return id
}
function clientSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!secret) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not set')
  return secret
}

export function gmailRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.fordra.com'
  return `${base}/api/admin/email-oauth/google/callback`
}

/** The consent-screen URL the settings Connect button points at. */
export function gmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: gmailRedirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    // offline + consent force a refresh token on every connect, so
    // reconnecting an org always yields a working credential.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10000),
  })
  const text = await res.text()
  if (!res.ok) {
    // Google's error JSON is safe to surface (no tokens in it).
    throw new Error(`Google token endpoint responded ${res.status}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as TokenResponse
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: gmailRedirectUri(),
    grant_type: 'authorization_code',
  })
}

/** The connected mailbox's canonical address, fetched once at connect time. */
export async function fetchGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${API}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Gmail profile fetch responded ${res.status}`)
  const data = await res.json() as { emailAddress?: string }
  if (!data.emailAddress) throw new Error('Gmail profile fetch returned no email address')
  return { emailAddress: data.emailAddress }
}

/**
 * A live access token for the account: the stored one when still valid,
 * otherwise refreshed and re-persisted (encrypted). A dead refresh token
 * (invalid_grant — revoked, or an expired Testing-mode grant) flips the
 * account to status 'error' so the settings card shows Reconnect.
 */
export async function accessTokenFor(svc: SupabaseClient, account: EmailAccountRow): Promise<string> {
  const expiresAt = account.access_token_expires_at ? new Date(account.access_token_expires_at).getTime() : 0
  if (account.access_token_enc && expiresAt > Date.now() + 60_000) {
    return decryptSecret(account.access_token_enc)
  }
  let token: TokenResponse
  try {
    token = await tokenRequest({
      refresh_token: decryptSecret(account.refresh_token_enc),
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('invalid_grant')) {
      await svc.from('email_accounts').update({
        status: 'error',
        error: 'Google rejected the saved credential. Reconnect the mailbox in Settings.',
        updated_at: new Date().toISOString(),
      }).eq('id', account.id)
    }
    throw e
  }
  await svc.from('email_accounts').update({
    access_token_enc: encryptSecret(token.access_token),
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    status: 'connected',
    error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id)
  return token.access_token
}

// ---------------------------------------------------------------------------
// MIME building (hand-rolled RFC 2822: text/plain + base64 attachment parts.
// Small enough that a mail dependency isn't justified.)

const CRLF = '\r\n'

/** RFC 2047 header encoding for non-ASCII subjects/names. */
function encodeHeaderText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

function formatAddress(email: string, name?: string | null): string {
  if (!name?.trim()) return email
  return `${encodeHeaderText(name.trim()).replace(/[<>]/g, '')} <${email}>`
}

function base64Lines(buf: Buffer): string {
  return buf.toString('base64').replace(/(.{76})/g, `$1${CRLF}`)
}

export function buildMime(account: Pick<EmailAccountRow, 'email_address' | 'display_name'>, msg: OutgoingEmail): { mime: string; messageIdHeader: string } {
  const messageIdHeader = `<${randomUUID()}@fordra.app>`
  const headers: string[] = [
    `From: ${formatAddress(account.email_address, account.display_name)}`,
    `To: ${msg.to.join(', ')}`,
    ...(msg.cc.length ? [`Cc: ${msg.cc.join(', ')}`] : []),
    `Subject: ${encodeHeaderText(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageIdHeader}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`] : []),
    ...(msg.references ? [`References: ${msg.references}`] : []),
    'MIME-Version: 1.0',
  ]
  const encodedPart = (contentType: string, content: string) =>
    `Content-Type: ${contentType}${CRLF}`
    + `Content-Transfer-Encoding: base64${CRLF}${CRLF}`
    + base64Lines(Buffer.from(content, 'utf8'))
  const wrapParts = (contentType: string, parts: string[]) => {
    const boundary = `fordra_${randomUUID().replace(/-/g, '')}`
    return {
      header: `Content-Type: ${contentType}; boundary="${boundary}"`,
      body: parts.map(p => `--${boundary}${CRLF}${p}`).join(CRLF) + `${CRLF}--${boundary}--`,
    }
  }

  // Rich bodies send as multipart/alternative (plain fallback + HTML), which
  // nests inside multipart/mixed when attachments ride along.
  const textPart = encodedPart('text/plain; charset="UTF-8"', msg.bodyText)
  let bodyHeader: string | null = null
  let body: string
  if (msg.bodyHtml) {
    const alt = wrapParts('multipart/alternative', [
      textPart,
      encodedPart('text/html; charset="UTF-8"', msg.bodyHtml),
    ])
    bodyHeader = alt.header
    body = alt.body
  } else {
    bodyHeader = 'Content-Type: text/plain; charset="UTF-8"' + CRLF + 'Content-Transfer-Encoding: base64'
    body = base64Lines(Buffer.from(msg.bodyText, 'utf8'))
  }
  let mime: string
  if (!msg.attachments.length) {
    headers.push(bodyHeader)
    mime = headers.join(CRLF) + CRLF + CRLF + body
  } else {
    const mixed = wrapParts('multipart/mixed', [
      bodyHeader + CRLF + CRLF + body,
      ...msg.attachments.map(a =>
        `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${a.filename.replace(/"/g, '')}"${CRLF}`
        + `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, '')}"${CRLF}`
        + `Content-Transfer-Encoding: base64${CRLF}${CRLF}`
        + base64Lines(Buffer.from(a.bytes))),
    ])
    headers.push(mixed.header)
    mime = headers.join(CRLF) + CRLF + CRLF + mixed.body
  }
  return { mime, messageIdHeader }
}

// ---------------------------------------------------------------------------
// Fetch-side parsing

interface GmailHeader { name: string; value: string }
interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPart[]
}
interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart
}

const header = (headers: GmailHeader[] | undefined, name: string): string | null =>
  headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** Good-enough HTML-to-text for HTML-only replies (Outlook, phones). */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walkParts(part: GmailPart | undefined, out: { text?: string; html?: string; attachments: EmailMessageAttachment[] }): void {
  if (!part) return
  if (part.filename) {
    out.attachments.push({
      filename: part.filename,
      ...(part.mimeType ? { mime_type: part.mimeType } : {}),
      ...(part.body?.size ? { size: part.body.size } : {}),
    })
  } else if (part.mimeType === 'text/plain' && part.body?.data && out.text === undefined) {
    out.text = decodeBody(part.body.data)
  } else if (part.mimeType === 'text/html' && part.body?.data && out.html === undefined) {
    out.html = decodeBody(part.body.data)
  }
  for (const p of part.parts ?? []) walkParts(p, out)
}

/** 'Jane Doe <jane@x.com>' → parts; bare addresses pass through. */
function parseAddress(raw: string | null): { email: string | null; name: string | null } {
  if (!raw) return { email: null, name: null }
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/)
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1]?.trim() || null }
  return { email: raw.trim().toLowerCase() || null, name: null }
}

const parseAddressList = (raw: string | null): string[] =>
  (raw ?? '').split(',').map(a => parseAddress(a).email ?? '').filter(Boolean)

function toFetchedMessage(m: GmailMessage, accountEmail: string): FetchedMessage {
  const headers = m.payload?.headers
  const out: { text?: string; html?: string; attachments: EmailMessageAttachment[] } = { attachments: [] }
  walkParts(m.payload, out)
  const from = parseAddress(header(headers, 'From'))
  return {
    provider_message_id: m.id,
    message_id_header: header(headers, 'Message-ID'),
    in_reply_to: header(headers, 'In-Reply-To'),
    direction: from.email === accountEmail.toLowerCase() ? 'outbound' : 'inbound',
    from_email: from.email,
    from_name: from.name,
    to_emails: parseAddressList(header(headers, 'To')),
    cc_emails: parseAddressList(header(headers, 'Cc')),
    subject: header(headers, 'Subject'),
    body_text: out.text ?? (out.html ? htmlToText(out.html) : null),
    attachments: out.attachments,
    sent_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
  }
}

// ---------------------------------------------------------------------------
// The provider

export const gmailProvider: EmailProvider = {
  async send(svc, account, msg): Promise<SendResult> {
    const token = await accessTokenFor(svc, account)
    const { mime, messageIdHeader } = buildMime(account, msg)
    const res = await fetch(`${API}/users/me/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        ...(msg.providerThreadId ? { threadId: msg.providerThreadId } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Gmail send responded ${res.status}: ${text.slice(0, 300)}`)
    const data = JSON.parse(text) as { id: string; threadId: string }
    return { providerThreadId: data.threadId, providerMessageId: data.id, messageIdHeader }
  },

  async fetchThread(svc, account, providerThreadId): Promise<FetchedMessage[]> {
    const token = await accessTokenFor(svc, account)
    const res = await fetch(`${API}/users/me/threads/${providerThreadId}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`Gmail thread fetch responded ${res.status}`)
    const data = await res.json() as { messages?: GmailMessage[] }
    return (data.messages ?? []).map(m => toFetchedMessage(m, account.email_address))
  },
}
