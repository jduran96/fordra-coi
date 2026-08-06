import { pacificDateAtTime } from '@/lib/dates'

/**
 * Email outreach records (email_accounts / email_threads / email_messages,
 * migration 0040): the pure types and formatters, safe to import from client
 * components. Everything that touches Gmail or the database lives in
 * lib/gmail.ts, lib/email-provider.ts, and lib/email-sync.ts (server-only) —
 * importing those from a client component drags OAuth secrets handling into
 * the browser bundle.
 *
 * One email_threads row per Fordra-initiated thread; `payload` is the exact
 * send the admin approved (frozen at approval, the audit artifact). Replies
 * arrive by re-fetching the provider thread and deduping on the provider
 * message id, so refreshes are idempotent no matter how often they run.
 */

export type EmailThreadStatus = 'draft' | 'approved' | 'sent' | 'failed'

/** email_accounts minus every token column: the only shape the UI ever sees. */
export interface EmailAccountPublic {
  id: string
  org_id: string
  provider: string
  email_address: string
  display_name: string | null
  status: 'connected' | 'error'
  error: string | null
  connected_by: string
  created_at: string
}

/** The account columns safe to select for UI use. Never add token columns. */
export const EMAIL_ACCOUNT_PUBLIC_COLUMNS =
  'id, org_id, provider, email_address, display_name, status, error, connected_by, created_at'

export interface EmailAttachmentRef {
  document_id: string
  file_name: string
}

export interface EmailThread {
  id: string
  verification_id: string
  account_id: string | null
  created_at: string
  updated_at: string
  created_by: string
  status: EmailThreadStatus
  subject: string | null
  to_emails: string[] | null
  cc_emails: string[] | null
  body_text: string | null
  attachments: EmailAttachmentRef[] | null
  draft_input: Record<string, string> | null
  payload: Record<string, unknown> | null
  approved_by: string | null
  approved_at: string | null
  provider: string | null
  provider_thread_id: string | null
  provider_message_id: string | null
  last_message_at: string | null
  last_direction: 'outbound' | 'inbound' | null
  message_count: number
  last_synced_at: string | null
  published_note_at: string | null
  error: string | null
}

export interface EmailMessageAttachment {
  filename: string
  mime_type?: string
  size?: number
}

export interface EmailMessage {
  id: string
  thread_id: string
  provider_message_id: string
  message_id_header: string | null
  in_reply_to: string | null
  direction: 'outbound' | 'inbound'
  from_email: string | null
  from_name: string | null
  to_emails: string[] | null
  cc_emails: string[] | null
  subject: string | null
  body_text: string | null
  attachments: EmailMessageAttachment[] | null
  sent_at: string | null
  created_at: string
}

/** A reply landed and no one has responded yet: the row marker in every threads table. */
export function threadAwaitingReply(t: Pick<EmailThread, 'status' | 'last_direction'>): boolean {
  return t.status === 'sent' && t.last_direction === 'inbound'
}

export function threadStatusLabel(t: Pick<EmailThread, 'status'>): string {
  switch (t.status) {
    case 'draft': return 'Draft'
    case 'approved': return 'Sending'
    case 'sent': return 'Sent'
    case 'failed': return 'Failed'
  }
}

/** Always-available email draft tokens, merged into the template's per-deal
 *  variables everywhere drafts substitute: the verification's org name, and
 *  every policy number the OCR read off the COI (comma-separated). */
export const ORG_NAME_TOKEN = 'org_name'
export const POLICY_NUMBERS_TOKEN = 'policy_numbers'

/**
 * Just the NEW text of an email: everything from the first quoted-history
 * marker down ("On ... wrote:", "-----Original Message-----", or ">" quote
 * lines) is dropped. Mail clients append the whole prior thread to every
 * reply; rendering that verbatim would repeat each message N times.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split('\n')
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (/^On .{0,200}wrote:$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || l.startsWith('>')) {
      cut = i
      break
    }
  }
  // "On ... wrote:" can wrap onto two lines; drop a dangling "On ..." opener.
  if (cut > 0 && /^On .{0,200}$/.test(lines[cut - 1]?.trim() ?? '') && cut < lines.length) cut -= 1
  const stripped = lines.slice(0, cut).join('\n').trim()
  return stripped || text.trim()
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Substitute {tokens} into a rich-text (HTML) draft body: values are plain
 *  text, so they are escaped before landing inside the markup. */
export function applyTokensToHtml(html: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [k, val]) => acc.replaceAll(`{${k}}`, escapeHtml(val.trim())),
    html,
  )
}

export const parseEmailList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string' && !!e.trim()) : []

/**
 * The contact-log serialization of a thread: chronological, every message in
 * full, headers people actually read (who/when/subject), attachment names
 * listed so inbound files are at least visible in the log. This string lands
 * in ContactNote.transcript, so it renders behind the existing expanders on
 * both report surfaces and prints in full in the PDF.
 */
export function formatThreadText(messages: EmailMessage[]): string {
  const ordered = messages.slice().sort((a, b) =>
    new Date(a.sent_at ?? a.created_at).getTime() - new Date(b.sent_at ?? b.created_at).getTime())
  return ordered.map(m => {
    const when = pacificDateAtTime(m.sent_at ?? m.created_at)
    const from = m.from_name ? `${m.from_name} <${m.from_email ?? ''}>` : (m.from_email ?? 'Unknown sender')
    const lines = [
      `On ${when}, ${from} wrote:`,
      `To: ${parseEmailList(m.to_emails).join(', ') || '(none)'}`,
    ]
    const cc = parseEmailList(m.cc_emails)
    if (cc.length) lines.push(`Cc: ${cc.join(', ')}`)
    if (m.subject) lines.push(`Subject: ${m.subject}`)
    const files = (m.attachments ?? []).map(a => a.filename).filter(Boolean)
    if (files.length) lines.push(`Attachments: ${files.join(', ')}`)
    // Only each message's new text: the quoted history a client appends
    // would repeat every earlier message once per reply.
    lines.push('', stripQuotedReply(m.body_text ?? '') || '(no text)')
    return lines.join('\n')
  }).join('\n\n----------\n\n')
}
