/**
 * Per-org, per-template email draft templates (admin settings → Emails →
 * Drafts). The configured subject/body prefill the verification's Emails-tab
 * draft instead of an OCR/AI generation pass, mirroring the Questions List
 * (lib/question-config.ts). Subject and body may embed {tokens}: tokens
 * matching the template's per-deal variables substitute automatically; any
 * other {token} is left in the text for the admin to fill before sending
 * (send blocks while one remains).
 *
 * Stored in app_config under `email_draft:<orgId>:<templateId>` (same registry
 * + RLS as questions_config). Client-safe module: pure helpers only.
 */

export const EMAIL_DRAFT_KEY = 'email_draft'
export const emailDraftKey = (orgId: string, templateId: string) =>
  `${EMAIL_DRAFT_KEY}:${orgId}:${templateId}`

export interface EmailDraftConfig {
  /** Subject line, possibly with {tokens}. */
  subject: string
  /** Plain-text email body, possibly with {tokens}. */
  body: string
  /** Always-cc list (e.g. a company inbox that archives outreach). */
  cc: string[]
  /** Also cc the carrier/producer email from the COI when the OCR found one
   *  and it is not already the To address. */
  include_carrier_email?: boolean
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Tolerant read of a stored config value; null when empty or unreadable. */
export function parseEmailDraftConfig(value: unknown): EmailDraftConfig | null {
  if (!value || typeof value !== 'object') return null
  const { subject, body, cc, include_carrier_email } = value as Record<string, unknown>
  const cleanSubject = typeof subject === 'string' ? subject.trim() : ''
  const cleanBody = typeof body === 'string' ? body.trim() : ''
  const cleanCc = Array.isArray(cc)
    ? cc.filter((e): e is string => typeof e === 'string' && EMAIL_RE.test(e.trim())).map(e => e.trim())
    : []
  if (!cleanSubject && !cleanBody && !cleanCc.length && include_carrier_email !== true) return null
  return {
    subject: cleanSubject,
    body: cleanBody,
    cc: cleanCc,
    ...(include_carrier_email === true ? { include_carrier_email: true } : {}),
  }
}
