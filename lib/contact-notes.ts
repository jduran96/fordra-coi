import type { ContactCheckEntry, NoteContactCheck } from './types'

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
  return {
    ...(phoneEntry ? { phone_status: phoneEntry.phone_status } : {}),
    ...(emailEntry ? { email_status: emailEntry.email_status } : {}),
    blurb: blurbs.join(' '),
    sources,
    checked_at: checkedAts.sort().pop() ?? '',
  }
}
