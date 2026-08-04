import type { AiCallQuestion } from '@/lib/call-config'

export type { AiCallQuestion } from '@/lib/call-config'

/**
 * AI voice-agent dispatch records (ai_calls table, migration 0032): the pure
 * types and mappers, safe to import from client components. Everything that
 * touches Retell or the database lives in lib/ai-calls.ts (server-only) —
 * importing THAT module from a client component drags the Retell SDK into the
 * browser bundle, where its module-scope constructor throws on the missing
 * RETELL_API_KEY and takes down the whole page.
 *
 * One row per dispatch attempt; `payload` is the exact variable map the admin
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
  transcript_detail: TranscriptEntry[] | null
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

/**
 * Retell's transcript_with_tool_calls entries, hand-declared so client
 * components can consume them without importing retell-sdk (see the module
 * header). A strict superset of transcript_object: speech utterances with
 * per-word timings plus tool calls, node transitions, and DTMF presses.
 */
export type TranscriptWord = { word?: string; start?: number; end?: number }
export type TranscriptEntry =
  | { role: 'agent' | 'user' | 'transfer_target'; content: string; words?: TranscriptWord[] }
  | { role: 'tool_call_invocation'; name: string; arguments: string; tool_call_id?: string }
  | { role: 'tool_call_result'; content: string; tool_call_id?: string }
  | { role: 'node_transition'; former_node_name?: string; new_node_name?: string }
  | { role: 'dtmf'; digit: string }
  | { role: 'sms'; content: string; time_sec?: number }

/** The subset of Retell's call object the mapper reads. */
export interface RetellCallSnapshot {
  call_id?: string
  call_status?: 'registered' | 'not_connected' | 'ongoing' | 'ended' | 'error'
  transcript?: string
  transcript_with_tool_calls?: TranscriptEntry[]
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
  if (call.transcript_with_tool_calls?.length) patch.transcript_detail = call.transcript_with_tool_calls
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

/**
 * Custom analysis fields, in render order. These names mirror the Retell
 * agent's post_call_analysis_data schema (dashboard-owned); a field absent
 * from a call's analysis renders nothing.
 * - alwaysShow: render 'yes' AND 'no' (the answer matters both ways).
 *   Everything else renders only when meaningfully present: booleans only
 *   when true ("Claimed no record: no" was pure noise, owner call
 *   2026-07-29), strings only when non-empty and not 'none'.
 */
const CUSTOM_FIELDS: { key: string; label: string; alwaysShow?: boolean }[] = [
  { key: 'all_questions_answered', label: 'All questions answered', alwaysShow: true },
  { key: 'blockers_outcome', label: 'Blockers', alwaysShow: true },
  { key: 'not_confirmed', label: 'Not confirmed', alwaysShow: true },
  { key: 'responder_name', label: 'Spoke with' },
  { key: 'responder_role', label: 'Role' },
  { key: 'responder_department', label: 'Department' },
  { key: 'captured_email', label: 'Email captured' },
  { key: 'refusal_reason', label: 'Refusal reason' },
  { key: 'claimed_no_record', label: 'Claimed no record' },
  { key: 'portal_named', label: 'Portal named' },
  { key: 'other_entity_referred', label: 'Referred to' },
  { key: 'fix_initiated', label: 'Fix initiated' },
]

/**
 * Build the publishable summary HTML from Retell's post-call analysis: the
 * outcome summary paragraph (the custom outcome_summary field when the agent
 * schema provides it, else Retell's call_summary) plus the key-facts list
 * (voice spec §6.6). Output is plain p/ul/li markup that passes the note
 * sanitizer's allowlist unchanged.
 */
export function summaryHtmlFromAnalysis(analysis: RetellCallAnalysis | null): string {
  if (!analysis) return ''
  const parts: string[] = []
  const custom = (analysis.custom_analysis_data ?? {}) as Record<string, unknown>
  const summary = (String(custom.outcome_summary ?? '').trim() || (analysis.call_summary ?? '')).trim()
  if (summary) {
    for (const para of summary.split(/\n{2,}/)) {
      const p = para.trim()
      if (p) parts.push(`<p>${esc(p)}</p>`)
    }
  }
  const items: string[] = []
  for (const { key, label, alwaysShow } of CUSTOM_FIELDS) {
    const raw = custom[key]
    if (raw === undefined || raw === null || raw === '') continue
    if (!alwaysShow) {
      if (raw === false) continue
      if (typeof raw === 'string' && /^(none|no|n\/?a)$/i.test(raw.trim())) continue
    }
    const value = typeof raw === 'boolean' ? (raw ? 'yes' : 'no') : String(raw)
    items.push(`<li><strong>${esc(label)}:</strong> ${esc(value)}</li>`)
  }
  if (items.length) parts.push(`<ul>${items.join('')}</ul>`)
  return parts.join('')
}
