import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { retrieveCall } from '@/lib/retell'
import {
  TERMINAL_STATUSES, applyRetellCall, statusRank,
  type AiCall, type RetellCallSnapshot,
} from '@/lib/ai-call-shared'

// Server-side entry point for ai_calls: syncAiCall plus re-exports of the
// pure types/mappers. Client components must import lib/ai-call-shared.ts
// directly — this module is marked server-only because it (via lib/retell)
// instantiates the Retell SDK, which cannot ship to the browser.
export * from '@/lib/ai-call-shared'

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
  // Terminal rows re-sync once more if the structured transcript is missing
  // but a flat one exists (pre-0038 rows); failed/no-answer calls with no
  // transcript at all will never grow one, so they stay no-ops.
  if (terminal && row.call_analysis && (row.transcript_detail || !row.transcript)) return row
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
