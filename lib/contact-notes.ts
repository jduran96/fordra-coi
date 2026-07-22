import type { ContactCheckEntry, Legitimacy, NoteContactCheck } from './types'

/**
 * Normalize a contact field (name/phone/email) from a stored note: trims and
 * treats placeholder junk like "n/a" or "-" as missing, so renderers never
 * show a verification tag on a value that does not exist (seen live: a note
 * with email "n/a" wearing a "Differs from online" tag).
 */
export function contactValue(s: string | undefined | null): string {
  const v = (s ?? '').trim()
  return /^(n\/?a|none|-+|—)$/i.test(v) ? '' : v
}

/**
 * Phone comparison key: digits only, leading US country code dropped, so a
 * number copy-pasted from the online check card matches a log typed with any
 * punctuation ("(555) 123-4567" == "1-555-123-4567" == "555.123.4567").
 * Empty when the value is blank/placeholder junk.
 */
export function normalizePhone(s: string | undefined | null): string {
  const digits = contactValue(s).replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Email comparison key: case-insensitive. Empty for blank/junk values. */
export function normalizeEmail(s: string | undefined | null): string {
  return contactValue(s).toLowerCase()
}

/**
 * Consumer/free mailbox domains: an email on one of these says nothing about
 * the agency's website, so the check must find the official site by search
 * instead of fetching the mailbox provider's homepage.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'msn.com', 'live.com', 'comcast.net', 'att.net',
  'verizon.net', 'sbcglobal.net', 'proton.me', 'protonmail.com', 'mail.com',
])

/**
 * The domain of a logged email when it plausibly IS the agency's own domain:
 * lowercase, empty for blank/junk values, free mailbox providers, and
 * anything that does not look like a domain.
 */
export function corporateEmailDomain(email: string | undefined | null): string {
  const at = normalizeEmail(email).split('@')
  const domain = at.length === 2 ? at[1] : ''
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) return ''
  return FREE_EMAIL_DOMAINS.has(domain) ? '' : domain
}

/**
 * The overall verdict for a check, derived from its raw findings — the model
 * reports facts, this is the single place the two-pronged criterion lives:
 * legit needs the agency's own website to align AND an external source
 * (social/directory/business listing) to confirm it. Undefined for entries
 * from before the two-pronged check existed (no website evidence recorded).
 */
export function deriveLegitimacy(check: Pick<NoteContactCheck, 'phone_status' | 'email_status' | 'website_status' | 'external_confirmation'>): Legitimacy | undefined {
  if (!check.website_status && !check.external_confirmation) return undefined
  const fieldDiffers = check.phone_status === 'differs' || check.email_status === 'differs'
  if (check.website_status === 'differs' || fieldDiffers) return 'mismatch'
  if (check.website_status === 'aligns' && check.external_confirmation === 'confirmed') return 'legit'
  return 'unverified'
}

/**
 * Build a contact log's verification snapshot from the verification-level
 * online-check history: a status key is set ONLY for a field whose value was
 * actually checked (missing key renders the dashed "Not checked online" tag).
 * The history is append-only, so the NEWEST entry that checked a value wins.
 * Returns null when neither field matches any checked value.
 */
export function noteCheckFromRegistry(
  entries: ContactCheckEntry[] | null | undefined,
  phone: string | undefined | null,
  email: string | undefined | null,
): NoteContactCheck | null {
  const list = Array.isArray(entries) ? entries : []
  const phoneKey = normalizePhone(phone)
  const emailKey = normalizeEmail(email)
  let phoneEntry: ContactCheckEntry | undefined
  let emailEntry: ContactCheckEntry | undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (!phoneEntry && phoneKey && e.phone_status && normalizePhone(e.phone) === phoneKey) phoneEntry = e
    if (!emailEntry && emailKey && e.email_status && normalizeEmail(e.email) === emailKey) emailEntry = e
    if ((phoneEntry || !phoneKey) && (emailEntry || !emailKey)) break
  }
  if (!phoneEntry && !emailEntry) return null

  const blurbs = [...new Set([phoneEntry?.blurb, emailEntry?.blurb].filter((b): b is string => !!b?.trim()))]
  const sources = [...new Set([...(phoneEntry?.sources ?? []), ...(emailEntry?.sources ?? [])])].slice(0, 8)
  const checkedAts = [phoneEntry?.checked_at, emailEntry?.checked_at].filter((s): s is string => !!s)
  // Agency-level findings (website/external/legitimacy) come from the newer
  // of the matched entries — they describe the agency, not one field, so one
  // entry's answer covers the whole snapshot. Explicit field whitelist: entry
  // extras like the checked phone/email values or usage telemetry must never
  // leak into the note.
  const newest = [phoneEntry, emailEntry]
    .filter((e): e is ContactCheckEntry => !!e)
    .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
    .pop()
  return {
    ...(phoneEntry ? { phone_status: phoneEntry.phone_status } : {}),
    ...(emailEntry ? { email_status: emailEntry.email_status } : {}),
    ...(newest?.website_status ? { website_status: newest.website_status } : {}),
    ...(newest?.external_confirmation ? { external_confirmation: newest.external_confirmation } : {}),
    ...(newest?.legitimacy ? { legitimacy: newest.legitimacy } : {}),
    ...(newest?.website_url ? { website_url: newest.website_url } : {}),
    blurb: blurbs.join(' '),
    sources,
    checked_at: checkedAts.sort().pop() ?? '',
  }
}
