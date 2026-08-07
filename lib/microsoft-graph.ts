import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, redirectUriFor, tokenRequest, type RefreshConfig, type TokenResponse } from '@/lib/email-oauth'
import type { EmailAccountRow, EmailProvider, FetchedMessage, OutgoingEmail, SendResult } from '@/lib/email-provider'
import { htmlToText, type EmailMessageAttachment } from '@/lib/email-shared'

/**
 * Microsoft Graph implementation of the email provider (lib/email-provider.ts)
 * for Outlook / Microsoft 365 mailboxes, raw fetch like lib/gmail.ts.
 *
 * Sends go through the JSON draft flow (create draft, attach, send) rather
 * than MIME sendMail: sendMail returns an empty 202 with none of the ids
 * SendResult needs, while a draft comes back with id, conversationId, and
 * internetMessageId before anything leaves the mailbox. Replies must use
 * createReply so Exchange writes the threading headers itself — Graph's JSON
 * shape only accepts custom internetMessageHeaders prefixed with x-, so
 * In-Reply-To can never be set directly.
 *
 * Every Graph call sends Prefer: IdType="ImmutableId". Without it a message's
 * id changes when the sent draft moves from Drafts to Sent Items, and the
 * (thread_id, provider_message_id) sync dedupe key silently breaks.
 *
 * MICROSOFT_OAUTH_TENANT picks the sign-in audience: 'common' (default) takes
 * both M365 org accounts and personal outlook.com accounts.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'
// Mail.ReadWrite covers draft create/patch/attach/createReply plus reading;
// Mail.Send covers the send call; offline_access yields the refresh token.
const OAUTH_SCOPES = 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send'

function clientId(): string {
  const id = process.env.MICROSOFT_OAUTH_CLIENT_ID
  if (!id) throw new Error('MICROSOFT_OAUTH_CLIENT_ID is not set')
  return id
}
function clientSecret(): string {
  const secret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET
  if (!secret) throw new Error('MICROSOFT_OAUTH_CLIENT_SECRET is not set')
  return secret
}
const authority = (): string =>
  `https://login.microsoftonline.com/${process.env.MICROSOFT_OAUTH_TENANT || 'common'}/oauth2/v2.0`

/** The consent-screen URL the settings Connect button points at. */
export function microsoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUriFor('microsoft'),
    scope: OAUTH_SCOPES,
    // The owner holds several Microsoft accounts; always let them pick.
    prompt: 'select_account',
    state,
  })
  return `${authority()}/authorize?${params}`
}

export async function exchangeMicrosoftCode(code: string): Promise<TokenResponse> {
  return tokenRequest('Microsoft', `${authority()}/token`, {
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUriFor('microsoft'),
    grant_type: 'authorization_code',
    scope: OAUTH_SCOPES,
  })
}

/** The connected mailbox's canonical address, fetched once at connect time.
 *  Work accounts carry it in `mail`; personal accounts often only in
 *  `userPrincipalName`. */
export async function fetchMicrosoftProfile(accessToken: string): Promise<{ emailAddress: string; displayName: string | null }> {
  const res = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Microsoft profile fetch responded ${res.status}`)
  const data = await res.json() as { mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }
  const emailAddress = (data.mail || data.userPrincipalName || '').trim().toLowerCase()
  if (!emailAddress) throw new Error('Microsoft profile fetch returned no email address')
  return { emailAddress, displayName: data.displayName?.trim() || null }
}

const MICROSOFT_REFRESH: RefreshConfig = {
  label: 'Microsoft',
  tokenUrl: `${authority()}/token`,
  params: refreshToken => ({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    scope: OAUTH_SCOPES,
  }),
  invalidGrantMessage: 'Microsoft rejected the saved credential. Reconnect the mailbox in Settings.',
}

const microsoftAccessTokenFor = (svc: SupabaseClient, account: EmailAccountRow): Promise<string> =>
  accessTokenFor(svc, account, MICROSOFT_REFRESH)

// ---------------------------------------------------------------------------
// Graph plumbing

async function graphRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; extraPrefer?: string } = {},
): Promise<T> {
  const prefer = `IdType="ImmutableId"${opts.extraPrefer ? `, ${opts.extraPrefer}` : ''}`
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: prefer,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
  })
  const text = await res.text()
  if (!res.ok) {
    // Graph error JSON carries codes and messages, never tokens.
    throw new Error(`Microsoft Graph ${method} ${path.split('?')[0]} responded ${res.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

interface GraphRecipient { emailAddress?: { address?: string; name?: string } }
interface GraphAttachment { name?: string; contentType?: string; size?: number; isInline?: boolean }
interface GraphMessage {
  id: string
  conversationId?: string
  internetMessageId?: string
  subject?: string | null
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  receivedDateTime?: string
  sentDateTime?: string
  isDraft?: boolean
  hasAttachments?: boolean
  body?: { contentType?: string; content?: string }
  attachments?: GraphAttachment[]
}

const toRecipient = (address: string): GraphRecipient => ({ emailAddress: { address } })

/** Graph JSON has no multipart/alternative: HTML when we have it (Exchange
 *  derives the plain part on the wire), plain text otherwise. */
const bodyFor = (msg: OutgoingEmail): { contentType: string; content: string } =>
  msg.bodyHtml ? { contentType: 'html', content: msg.bodyHtml } : { contentType: 'text', content: msg.bodyText }

/**
 * All messages in a conversation. $orderby cannot ride along with this filter
 * (Graph rejects it as InefficientFilter), so callers sort; the default page
 * size is 10, so paging is followed even for short threads.
 */
async function listConversation(
  token: string,
  conversationId: string,
  select: string,
  opts: { expand?: string; extraPrefer?: string } = {},
): Promise<GraphMessage[]> {
  const params = new URLSearchParams({
    $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    $top: '100',
    $select: select,
  })
  if (opts.expand) params.set('$expand', opts.expand)
  let path: string | null = `/me/messages?${params}`
  const out: GraphMessage[] = []
  while (path) {
    const page: { value?: GraphMessage[]; '@odata.nextLink'?: string } =
      await graphRequest(token, 'GET', path, undefined, { extraPrefer: opts.extraPrefer })
    out.push(...(page.value ?? []))
    const next = page['@odata.nextLink']
    path = next ? next.replace(GRAPH, '') : null
  }
  return out
}

const sentTime = (m: GraphMessage): number =>
  new Date(m.receivedDateTime ?? m.sentDateTime ?? 0).getTime()

const SIMPLE_ATTACHMENT_MAX = 3 * 1024 * 1024
const UPLOAD_CHUNK = 4 * 1024 * 1024

async function addAttachment(
  token: string,
  messageId: string,
  a: { filename: string; mimeType: string; bytes: Uint8Array },
): Promise<void> {
  if (a.bytes.byteLength < SIMPLE_ATTACHMENT_MAX) {
    await graphRequest(token, 'POST', `/me/messages/${messageId}/attachments`, {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.mimeType || 'application/octet-stream',
      contentBytes: Buffer.from(a.bytes).toString('base64'),
    }, { timeoutMs: 60000 })
    return
  }
  // 3 MB and up require an upload session with chunked PUTs of at most 4 MB.
  const session = await graphRequest<{ uploadUrl?: string }>(
    token, 'POST', `/me/messages/${messageId}/attachments/createUploadSession`, {
      AttachmentItem: { attachmentType: 'file', name: a.filename, size: a.bytes.byteLength },
    })
  if (!session.uploadUrl) throw new Error('Microsoft Graph returned no upload URL for a large attachment')
  for (let start = 0; start < a.bytes.byteLength; start += UPLOAD_CHUNK) {
    const chunk = a.bytes.subarray(start, Math.min(start + UPLOAD_CHUNK, a.bytes.byteLength))
    // The upload URL is pre-authorized; adding an Authorization header breaks it.
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${start + chunk.byteLength - 1}/${a.bytes.byteLength}`,
      },
      body: chunk as unknown as BodyInit,
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) throw new Error(`Microsoft Graph attachment upload responded ${res.status}`)
  }
}

// ---------------------------------------------------------------------------
// Fetch-side mapping

const addressOf = (r?: GraphRecipient): string | null =>
  r?.emailAddress?.address?.trim().toLowerCase() || null

const addressList = (rs?: GraphRecipient[]): string[] =>
  (rs ?? []).map(addressOf).filter((e): e is string => !!e)

function toFetchedMessage(m: GraphMessage, accountEmail: string): FetchedMessage {
  const from = addressOf(m.from)
  const content = m.body?.content ?? null
  const attachments: EmailMessageAttachment[] = (m.attachments ?? [])
    .filter(a => !a.isInline)
    .map(a => ({
      filename: a.name || 'attachment',
      ...(a.contentType ? { mime_type: a.contentType } : {}),
      ...(a.size ? { size: a.size } : {}),
    }))
  return {
    provider_message_id: m.id,
    message_id_header: m.internetMessageId ?? null,
    // Graph list reads don't return In-Reply-To; nothing consumes it for
    // Microsoft threads because replies go through createReply, not headers.
    in_reply_to: null,
    direction: from === accountEmail.toLowerCase() ? 'outbound' : 'inbound',
    from_email: from,
    from_name: m.from?.emailAddress?.name?.trim() || null,
    to_emails: addressList(m.toRecipients),
    cc_emails: addressList(m.ccRecipients),
    subject: m.subject ?? null,
    body_text: content === null
      ? null
      : (m.body?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content.trim()),
    attachments,
    sent_at: m.receivedDateTime ?? m.sentDateTime ?? null,
  }
}

// ---------------------------------------------------------------------------
// The provider

export const microsoftProvider: EmailProvider = {
  async send(svc, account, msg): Promise<SendResult> {
    const token = await microsoftAccessTokenFor(svc, account)
    const draftBody = {
      subject: msg.subject,
      body: bodyFor(msg),
      toRecipients: msg.to.map(toRecipient),
      ccRecipients: msg.cc.map(toRecipient),
    }
    let draft: GraphMessage
    if (msg.providerThreadId) {
      // Reply in-thread: createReply on the message being answered, then
      // replace Exchange's quoted stub with our composed content.
      const thread = await listConversation(token, msg.providerThreadId, 'id,internetMessageId,receivedDateTime,sentDateTime,isDraft')
      const target = thread.find(m => !!msg.inReplyTo && m.internetMessageId === msg.inReplyTo)
        ?? thread.filter(m => !m.isDraft).sort((a, b) => sentTime(b) - sentTime(a))[0]
      if (!target) throw new Error('Microsoft Graph could not find the message this reply answers')
      const stub = await graphRequest<GraphMessage>(token, 'POST', `/me/messages/${target.id}/createReply`)
      draft = await graphRequest<GraphMessage>(token, 'PATCH', `/me/messages/${stub.id}`, draftBody)
    } else {
      draft = await graphRequest<GraphMessage>(token, 'POST', '/me/messages', draftBody)
    }
    if (!draft.conversationId || !draft.internetMessageId) {
      throw new Error('Microsoft Graph draft came back without conversation ids')
    }
    for (const a of msg.attachments) await addAttachment(token, draft.id, a)
    await graphRequest(token, 'POST', `/me/messages/${draft.id}/send`, undefined, { timeoutMs: 30000 })
    return {
      providerThreadId: draft.conversationId,
      providerMessageId: draft.id,
      // Exchange-assigned rather than app-generated, serving the same purpose:
      // reply targeting and sync matching.
      messageIdHeader: draft.internetMessageId,
    }
  },

  async fetchThread(svc, account, providerThreadId): Promise<FetchedMessage[]> {
    const token = await microsoftAccessTokenFor(svc, account)
    const select = 'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,hasAttachments,body'
    const textPrefer = 'outlook.body-content-type="text"'
    let messages: GraphMessage[]
    try {
      messages = await listConversation(token, providerThreadId, select, {
        expand: 'attachments($select=name,contentType,size,isInline)',
        extraPrefer: textPrefer,
      })
    } catch {
      // Some mailboxes reject $expand alongside the conversationId filter;
      // fall back to the plain list plus per-message attachment metadata.
      messages = await listConversation(token, providerThreadId, select, { extraPrefer: textPrefer })
      for (const m of messages) {
        if (!m.hasAttachments) continue
        const res = await graphRequest<{ value?: GraphAttachment[] }>(
          token, 'GET', `/me/messages/${m.id}/attachments?$select=name,contentType,size,isInline`)
        m.attachments = res.value ?? []
      }
    }
    return messages
      .filter(m => !m.isDraft)
      .sort((a, b) => sentTime(a) - sentTime(b))
      .map(m => toFetchedMessage(m, account.email_address))
  },
}
