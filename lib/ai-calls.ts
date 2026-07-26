import { createServiceClient } from '@/lib/supabase/server'
import { retrieveCall } from '@/lib/retell'
import type { AiCallQuestion } from '@/lib/call-config'

export type { AiCallQuestion } from '@/lib/call-config'

/**
 * AI voice-agent dispatch records (ai_calls table, migration 0032). One row
 * per dispatch attempt; `payload` is the exact variable map the admin
 * approved (frozen at approval, the audit artifact). Everything Retell-derived
 * flows through ONE pure mapper (applyRetellCall) with a monotonic status
 * guard, so polling, the webhook, and post-stop syncs stay idempotent no
 * matter the arrival order.
 */

export type AiCallStatus =
  | 'draft' | 'rejected'
  | 'approved' | 'dispatched' | 'in_progress'
  | 'completed' | 'stopped' | 'failed'

export interface AiCall {
  id: string
  verification_id: string
  created_at: string
  updated_at: string
  created_by: string
  status: AiCallStatus
  to_number: string | null
  number_source: string | null
  questions: AiCallQuestion[] | null
  draft_input: Record<string, string> | null
  payload: Record<string, string> | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  retell_agent_id: string | null
  retell_call_id: string | null
  call_status: string | null
  transcript: string | null
  call_analysis: RetellCallAnalysis | null
  recording_url: string | null
  disconnection_reason: string | null
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  stopped_by: string | null
  published_note_at: string | null
  error: string | null
}

export interface RetellCallAnalysis {
  call_summary?: string
  custom_analysis_data?: Record<string, unknown>
  user_sentiment?: string
  call_successful?: boolean
  in_voicemail?: boolean
}

/** The subset of Retell's call object the mapper reads. */
export interface RetellCallSnapshot {
  call_id?: string
  call_status?: 'registered' | 'not_connected' | 'ongoing' | 'ended' | 'error'
  transcript?: string
  call_analysis?: RetellCallAnalysis
  recording_url?: string
  recording_multi_channel_url?: string
  disconnection_reason?: string
  start_timestamp?: number
  end_timestamp?: number
  duration_ms?: number
}

/**
 * Monotonic rank: a Retell-derived write never moves a row to a lower-ranked
 * status, and terminal rows only accept enrichment (late call_analysis /
 * recording), never a status change between terminals. This is what makes a
 * poll racing the webhook or the kill switch harmless.
 */
const STATUS_RANK: Record<AiCallStatus, number> = {
  draft: 0, rejected: 0,
  approved: 1, dispatched: 2, in_progress: 3,
  completed: 4, stopped: 4, failed: 4,
}

export function statusRank(status: AiCallStatus): number {
  return STATUS_RANK[status] ?? 0
}

export const ACTIVE_STATUSES: AiCallStatus[] = ['dispatched', 'in_progress']
export const TERMINAL_STATUSES: AiCallStatus[] = ['completed', 'stopped', 'failed']

/** Pure mapper: Retell call object -> ai_calls column patch (incl. derived status). */
export function applyRetellCall(call: RetellCallSnapshot): Partial<AiCall> {
  const patch: Partial<AiCall> = {}
  if (call.call_status) patch.call_status = call.call_status
  if (call.transcript) patch.transcript = call.transcript
  if (call.call_analysis) patch.call_analysis = call.call_analysis
  const recording = call.recording_multi_channel_url || call.recording_url
  if (recording) patch.recording_url = recording
  if (call.disconnection_reason) patch.disconnection_reason = call.disconnection_reason
  if (call.start_timestamp) patch.started_at = new Date(call.start_timestamp).toISOString()
  if (call.end_timestamp) patch.ended_at = new Date(call.end_timestamp).toISOString()
  if (typeof call.duration_ms === 'number') patch.duration_ms = call.duration_ms
  switch (call.call_status) {
    case 'ongoing':
      patch.status = 'in_progress'
      break
    case 'ended':
      patch.status = call.disconnection_reason === 'manual_stopped' ? 'stopped' : 'completed'
      break
    case 'error':
    case 'not_connected':
      patch.status = 'failed'
      break
    // 'registered' keeps the stored status (dispatched).
  }
  return patch
}

/**
 * Refresh one row from Retell: retrieve -> map -> rank-guarded update.
 * No-ops for rows without a retell_call_id and for terminal rows that already
 * carry their analysis. Returns the freshest row it knows.
 */
export async function syncAiCall(
  svc: ReturnType<typeof createServiceClient>,
  row: AiCall,
): Promise<AiCall> {
  if (!row.retell_call_id) return row
  const terminal = TERMINAL_STATUSES.includes(row.status)
  if (terminal && row.call_analysis) return row
  let snapshot: RetellCallSnapshot
  try {
    snapshot = await retrieveCall(row.retell_call_id) as RetellCallSnapshot
  } catch (e) {
    console.error('syncAiCall: retrieve failed', row.id, e)
    return row
  }
  const patch = applyRetellCall(snapshot)
  // Rank guard: never downgrade. A terminal row keeps its status; the patch
  // may still add transcript/analysis/recording.
  if (patch.status && statusRank(patch.status) < statusRank(row.status)) delete patch.status
  if (terminal) delete patch.status
  if (Object.keys(patch).length === 0) return row
  const { data, error } = await svc.from('ai_calls')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('syncAiCall: update failed', row.id, error)
    return { ...row, ...patch }
  }
  return data as AiCall
}

/** Human label for a finished call's outcome, from the Retell disconnection reason. */
export function dispositionLabel(row: Pick<AiCall, 'status' | 'disconnection_reason' | 'error'>): string {
  if (row.status === 'stopped') return 'Stopped by admin'
  if (row.status === 'failed') return row.error ? 'Failed' : 'Did not connect'
  if (row.status === 'rejected') return 'Rejected'
  switch (row.disconnection_reason) {
    case 'user_hangup': return 'Callee hung up'
    case 'agent_hangup': return 'Completed'
    case 'voicemail_reached': return 'Voicemail'
    case 'ivr_reached': return 'IVR only'
    case 'dial_busy': return 'Busy'
    case 'dial_no_answer': return 'No answer'
    case 'dial_failed': return 'Dial failed'
    case 'invalid_destination': return 'Invalid number'
    case 'inactivity': return 'Silence timeout'
    case 'max_duration_reached': return 'Hit time cap'
    case 'marked_as_spam': return 'Marked as spam'
    default: return row.disconnection_reason ? row.disconnection_reason.replaceAll('_', ' ') : ''
  }
}

/** Escape a string for embedding in the summary HTML. */
function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const CUSTOM_FIELD_LABELS: Record<string, string> = {
  responder_name: 'Spoke with',
  responder_role: 'Role',
  responder_department: 'Department',
  all_questions_answered: 'All questions answered',
  captured_email: 'Email captured',
  refusal_reason: 'Refusal reason',
  claimed_no_record: 'Claimed no record',
  portal_named: 'Portal named',
  other_entity_referred: 'Referred to',
  fix_initiated: 'Fix initiated',
}

/**
 * Build the publishable summary HTML from Retell's post-call analysis:
 * the call_summary paragraph plus a key-facts list from the custom analysis
 * fields (voice spec §6.6). Output is plain p/ul/li markup that passes the
 * note sanitizer's allowlist unchanged.
 */
export function summaryHtmlFromAnalysis(analysis: RetellCallAnalysis | null): string {
  if (!analysis) return ''
  const parts: string[] = []
  const summary = (analysis.call_summary ?? '').trim()
  if (summary) {
    for (const para of summary.split(/\n{2,}/)) {
      const p = para.trim()
      if (p) parts.push(`<p>${esc(p)}</p>`)
    }
  }
  const custom = analysis.custom_analysis_data
  if (custom && typeof custom === 'object') {
    const items: string[] = []
    for (const [key, label] of Object.entries(CUSTOM_FIELD_LABELS)) {
      const raw = (custom as Record<string, unknown>)[key]
      if (raw === undefined || raw === null || raw === '' || raw === 'none') continue
      const value = typeof raw === 'boolean' ? (raw ? 'yes' : 'no') : String(raw)
      items.push(`<li><strong>${esc(label)}:</strong> ${esc(value)}</li>`)
    }
    if (items.length) parts.push(`<ul>${items.join('')}</ul>`)
  }
  return parts.join('')
}
