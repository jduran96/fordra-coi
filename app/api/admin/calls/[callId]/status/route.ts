import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { ACTIVE_STATUSES, TERMINAL_STATUSES, syncAiCall, type AiCall } from '@/lib/ai-calls'
import { compactTranscriptEntries } from '@/lib/call-transcript'

export const dynamic = 'force-dynamic'

/**
 * Live status polling for one AI call (admin console only; the proxy passes
 * /api/admin/ through untouched and this route enforces the admin session
 * itself). Read-and-sync only: this endpoint can never place or stop a call.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const admin = await requireAdminApi()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { callId } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('ai_calls').select('*').eq('id', callId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not load the call.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let row = data as AiCall
  const needsSync = ACTIVE_STATUSES.includes(row.status)
    || (TERMINAL_STATUSES.includes(row.status) && !row.call_analysis)
    // Lazy backfill: pre-0038 finished calls have a flat transcript but no
    // structured detail; one more sync retrieves it from Retell.
    || (TERMINAL_STATUSES.includes(row.status) && !!row.transcript && !row.transcript_detail)
  if (needsSync) row = await syncAiCall(supabase, row)

  return NextResponse.json({
    status: row.status,
    callStatus: row.call_status,
    transcript: row.transcript ?? '',
    transcriptDetail: row.transcript_detail ? compactTranscriptEntries(row.transcript_detail) : null,
    disconnectionReason: row.disconnection_reason,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    hasAnalysis: !!row.call_analysis,
    recordingUrl: row.recording_url,
    published: !!row.published_note_at,
    error: row.error,
  })
}
