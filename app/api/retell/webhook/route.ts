import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/retell'
import { createServiceClient } from '@/lib/supabase/server'
import { applyRetellCall, statusRank, TERMINAL_STATUSES, type AiCall, type RetellCallSnapshot } from '@/lib/ai-calls'

export const dynamic = 'force-dynamic'

/**
 * Retell post-call webhook (production redundancy; localhost dev relies on
 * polling). Ingest-only: it updates existing ai_calls rows keyed by
 * retell_call_id and can never create or initiate a call. Writes go through
 * the same pure mapper + rank guard as polling, so out-of-order or duplicate
 * deliveries are harmless.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-retell-signature') ?? ''
  let valid = false
  try {
    valid = await verifyWebhookSignature(rawBody, signature)
  } catch (e) {
    console.error('retell webhook: signature check failed', e)
  }
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  let event: string | undefined
  let call: RetellCallSnapshot | undefined
  try {
    const body = JSON.parse(rawBody) as { event?: string; call?: RetellCallSnapshot }
    event = body.event
    call = body.call
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 })
  }
  if (!call?.call_id || !event) return NextResponse.json({ ok: true })

  const supabase = createServiceClient()
  const { data } = await supabase.from('ai_calls')
    .select('*')
    .eq('retell_call_id', call.call_id)
    .maybeSingle()
  // Unknown call id: not one of ours (or a test call) — acknowledge and move on.
  if (!data) return NextResponse.json({ ok: true })

  const row = data as AiCall
  const patch = applyRetellCall(call)
  if (patch.status && statusRank(patch.status) < statusRank(row.status)) delete patch.status
  if (TERMINAL_STATUSES.includes(row.status)) delete patch.status
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('ai_calls')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) console.error('retell webhook: update failed', row.id, error)
  }
  return NextResponse.json({ ok: true })
}
