import type { ContactCheckEntry, OnlineListingStatus } from '@/lib/types'

/**
 * The deterministic "Contact check" gap-analysis row (owner ask 2026-08-06):
 * whether the certificate's producer phone/email were found in public online
 * listings. Appended by runAssessmentPipeline AFTER the model verdicts — the
 * model never judges it — and rendered like any other row on the admin form,
 * customer report, and PDF, except it carries no insurer-confirmation state
 * (isContactCheckItem exempts it from the check/x badges: web verification is
 * neither a call nor an email). Client-safe pure module.
 */

export const CONTACT_CHECK_LABEL = 'Contact check'

/** True for the deterministic contact-check row (label match, case-insensitive). */
export function isContactCheckItem(requirement?: { coverage_type?: string | null } | null): boolean {
  return (requirement?.coverage_type ?? '').trim().toLowerCase() === CONTACT_CHECK_LABEL.toLowerCase()
}

export interface ContactCheckGapItem {
  requirement: { coverage_type: string; minimum_limit: string; notes: string }
  status: 'met' | 'not_met' | 'uncertain'
  evidence: string
}

/** Newest defined status per field across the append-only check history. */
function latestStatus(entries: ContactCheckEntry[], field: 'phone_status' | 'email_status'): OnlineListingStatus | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const s = entries[i]?.[field]
    if (s === 'verified' || s === 'differs' || s === 'not_found') return s
  }
  return undefined
}

/**
 * Both found online = passed; one = warning; neither = failed. "Found" means
 * the online check verified the value; a value public listings contradict
 * ("differs") is NOT found, and the evidence says so. No check run yet =
 * warning, so the row never silently disappears from the report.
 */
export function contactCheckGapItem(rawEntries: unknown): ContactCheckGapItem {
  const entries = (Array.isArray(rawEntries) ? rawEntries : []) as ContactCheckEntry[]
  const requirement = {
    coverage_type: CONTACT_CHECK_LABEL,
    minimum_limit: '',
    notes: 'The insurance agency contact information on the certificate is checked against public online listings.',
  }
  const phone = latestStatus(entries, 'phone_status')
  const email = latestStatus(entries, 'email_status')
  if (!phone && !email) {
    return { requirement, status: 'uncertain', evidence: 'Contact information has not been checked online yet.' }
  }
  const phoneFound = phone === 'verified'
  const emailFound = email === 'verified'
  const differs = [phone === 'differs' ? 'phone' : '', email === 'differs' ? 'email' : ''].filter(Boolean)
  const differsNote = differs.length ? ` The listed ${differs.join(' and ')} differs from public listings.` : ''
  if (phoneFound && emailFound) {
    return { requirement, status: 'met', evidence: 'Both phone and email found online.' }
  }
  if (phoneFound || emailFound) {
    return {
      requirement,
      status: 'uncertain',
      evidence: `Only ${phoneFound ? 'phone' : 'email'} found online.${differsNote}`,
    }
  }
  return { requirement, status: 'not_met', evidence: `Neither phone nor email found online.${differsNote}` }
}
