/**
 * Internal admin organization flag: who called or left a voicemail on a
 * request (JD or EM). Purely an admin bookkeeping aid, set from the detail
 * page — never shown to customers and never affects case_status.
 */
export type InternalFlag = 'called_jd' | 'called_em' | 'voicemail_jd' | 'voicemail_em'

export const INTERNAL_FLAGS: { value: InternalFlag; label: string; pill: string }[] = [
  { value: 'called_jd', label: 'Called — JD', pill: 'Called · JD' },
  { value: 'called_em', label: 'Called — EM', pill: 'Called · EM' },
  { value: 'voicemail_jd', label: 'Left voicemail — JD', pill: 'Voicemail · JD' },
  { value: 'voicemail_em', label: 'Left voicemail — EM', pill: 'Voicemail · EM' },
]

export function internalFlagLabel(flag: string | null | undefined): string | null {
  return INTERNAL_FLAGS.find(f => f.value === flag)?.pill ?? null
}

export function internalFlagColor(flag: string | null | undefined): string {
  return flag === 'called_jd' || flag === 'voicemail_jd' ? 'oklch(55% 0.13 250)' : 'oklch(55% 0.15 320)'
}
