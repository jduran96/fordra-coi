import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { connectorByProvider } from '@/lib/email-connectors'
import type { EmailMessageAttachment } from '@/lib/email-shared'

/**
 * Provider abstraction for the email outreach feature: everything upstream
 * (send action, sync, settings) talks to this interface. Implementations live
 * in lib/gmail.ts and lib/microsoft-graph.ts and register in
 * lib/email-connectors.ts — adding a vendor means one new module implementing
 * send() and fetchThread() plus a registry entry, nothing else.
 */

/** The full email_accounts row, tokens included. Server-side only — the UI
 *  gets EmailAccountPublic (lib/email-shared.ts) instead. */
export interface EmailAccountRow {
  id: string
  org_id: string
  provider: string
  email_address: string
  display_name: string | null
  refresh_token_enc: string
  access_token_enc: string | null
  access_token_expires_at: string | null
  status: 'connected' | 'error'
}

export interface OutgoingEmail {
  to: string[]
  cc: string[]
  subject: string
  bodyText: string
  /** Sanitized rich-text body; when present the mail sends as
   *  multipart/alternative with bodyText as the plain fallback. */
  bodyHtml?: string
  attachments: { filename: string; mimeType: string; bytes: Uint8Array }[]
  /** Reply threading; absent on the initial send. */
  providerThreadId?: string
  inReplyTo?: string
  references?: string
}

export interface SendResult {
  providerThreadId: string
  providerMessageId: string
  /** The RFC 822 Message-ID we generated, for future In-Reply-To chains. */
  messageIdHeader: string
}

/** Maps 1:1 to email_messages columns; the sync layer only adds thread_id. */
export interface FetchedMessage {
  provider_message_id: string
  message_id_header: string | null
  in_reply_to: string | null
  direction: 'outbound' | 'inbound'
  from_email: string | null
  from_name: string | null
  to_emails: string[]
  cc_emails: string[]
  subject: string | null
  body_text: string | null
  attachments: EmailMessageAttachment[]
  sent_at: string | null
}

export interface EmailProvider {
  send(svc: SupabaseClient, account: EmailAccountRow, msg: OutgoingEmail): Promise<SendResult>
  fetchThread(svc: SupabaseClient, account: EmailAccountRow, providerThreadId: string): Promise<FetchedMessage[]>
}

export function providerFor(account: Pick<EmailAccountRow, 'provider'>): EmailProvider {
  const impl = connectorByProvider(account.provider)?.impl
  if (!impl) throw new Error(`No email provider implementation for '${account.provider}'`)
  return impl
}
