/**
 * Admin activity log: append-only record of admin actions on a verification
 * (called, left voicemail, emailed, free note), each stamped with when and by
 * whom. Replaces the old single-value internal_flag dropdown, which could
 * only remember the LAST action; the log answers "3 voicemails were left over
 * 3 days". Admin bookkeeping only: never shown to customers, never affects
 * case_status. Stored in verifications.admin_activity (no grants to
 * `authenticated`), appended via the admin_append_activity RPC.
 */

export type AdminActivityKind = 'called' | 'voicemail' | 'emailed' | 'note'

export interface AdminActivityEntry {
  at: string
  kind: AdminActivityKind
  /** Admin initials derived from the session email at log time. */
  by: string
  note?: string | null
}

export const ACTIVITY_KINDS: { value: AdminActivityKind; label: string; pill: string; noun: string }[] = [
  { value: 'called', label: 'Called the insurer', pill: 'Called', noun: 'call' },
  { value: 'voicemail', label: 'Left a voicemail', pill: 'VM', noun: 'voicemail' },
  { value: 'emailed', label: 'Emailed the insurer', pill: 'Emailed', noun: 'email' },
  { value: 'note', label: 'Other note', pill: 'Note', noun: 'note' },
]

export function activityKind(value: string): AdminActivityKind | null {
  return ACTIVITY_KINDS.some(k => k.value === value) ? (value as AdminActivityKind) : null
}

/** Session email -> the initials shown on log entries. Extend the map as admins join. */
const ADMIN_INITIALS: Record<string, string> = {
  'jullianalfonso96@gmail.com': 'JD',
  'emman0621@gmail.com': 'EM',
}
export function adminInitials(email: string): string {
  const e = email.trim().toLowerCase()
  if (ADMIN_INITIALS[e]) return ADMIN_INITIALS[e]
  if (e.includes('jullian')) return 'JD'
  return e.split('@')[0].slice(0, 2).toUpperCase()
}

/** Tolerate any stored shape; keep only well-formed entries, oldest first. */
export function normalizeActivity(raw: unknown): AdminActivityEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is AdminActivityEntry =>
      !!e && typeof e === 'object'
      && typeof (e as AdminActivityEntry).at === 'string'
      && typeof (e as AdminActivityEntry).by === 'string'
      && !!activityKind(String((e as AdminActivityEntry).kind)))
    .sort((a, b) => a.at.localeCompare(b.at))
}

function pacificDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Per-kind rollup, e.g. "3 voicemails over 3 days · 1 call". "over N days"
 * counts the distinct (Pacific) calendar days the action happened on, and
 * only shows when it spans more than one.
 */
export function summarizeActivity(entries: AdminActivityEntry[]): string {
  const parts: string[] = []
  for (const k of ACTIVITY_KINDS) {
    const of = entries.filter(e => e.kind === k.value)
    if (!of.length) continue
    const days = new Set(of.map(e => pacificDay(e.at))).size
    let part = `${of.length} ${k.noun}${of.length > 1 ? 's' : ''}`
    if (of.length > 1 && days > 1) part += ` over ${days} days`
    parts.push(part)
  }
  return parts.join(' · ')
}

/** Compact queue-pill text, e.g. "VM ×3 · Called ×1". */
export function activityPillText(entries: AdminActivityEntry[]): string | null {
  if (!entries.length) return null
  const parts: string[] = []
  for (const k of ACTIVITY_KINDS) {
    const n = entries.filter(e => e.kind === k.value).length
    if (n) parts.push(n > 1 ? `${k.pill} ×${n}` : k.pill)
  }
  return parts.join(' · ')
}
