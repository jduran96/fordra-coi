import { C } from '@/lib/theme'

/**
 * Admin-facing lifecycle of a verification, derived from work artifacts:
 *   New         — received, no admin action taken yet
 *   In Progress — extraction ran, notes saved, or a review drafted, but not published
 *   Complete    — result published to the customer
 * (The customer keeps seeing the coarser `status` = pending/completed/error.)
 */
export type AdminStatus = 'New' | 'In Progress' | 'Complete'

export function deriveAdminStatus(v: {
  published_at?: string | null
  coi_extracted?: unknown
  call_notes?: unknown
  manual_notes?: string | null
  insurance_contact?: unknown
  final_report?: unknown
}): AdminStatus {
  if (v.published_at) return 'Complete'
  const contact = v.insurance_contact as Record<string, string> | null | undefined
  const hasContact = !!contact && Object.values(contact).some(x => !!x?.trim?.())
  const worked =
    !!v.coi_extracted ||
    (Array.isArray(v.call_notes) && v.call_notes.length > 0) ||
    !!v.manual_notes?.trim() ||
    hasContact ||
    !!v.final_report
  return worked ? 'In Progress' : 'New'
}

export function adminStatusColor(s: AdminStatus): string {
  if (s === 'Complete') return C.ok
  if (s === 'In Progress') return 'oklch(55% 0.13 250)'
  return C.warn
}
