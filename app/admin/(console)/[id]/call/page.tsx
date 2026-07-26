import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { C } from '@/lib/theme'
import { getCallConfig } from '@/lib/config'
import { draftFromVerification, CONTEXT_FIELD_NAMES, type CallContextFields } from '@/lib/call-config'
import { ACTIVE_STATUSES, type AiCall } from '@/lib/ai-calls'
import type { COIExtracted, ContactCheckEntry } from '@/lib/types'
import CallReviewForm from './CallReviewForm'
import LiveCallPanel from '../LiveCallPanel'

export const dynamic = 'force-dynamic'

/**
 * Pre-dial review screen (voice spec v5 §10): the human-in-the-loop gate in
 * front of every AI call. Prefills from the COI extraction + org call config
 * (or the saved draft), validates, and dispatches. While a call is live, the
 * form yields to the live panel: one in-flight call per verification.
 */
export default async function CallReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAdmin()
  const supabase = createServiceClient()
  const { data: v, error } = await withRetry(() => supabase
    .from('verifications')
    .select('id, display_id, org_id, carrier_name, published_at, case_status, coi_extracted, agent_questions, insurance_contact, contact_checks, orgs(name)')
    .eq('id', id)
    .maybeSingle())
  if (!v) {
    if (error) throw new Error('Could not load this verification. Please retry.')
    notFound()
  }

  const { data: callRows, error: callsErr } = await supabase
    .from('ai_calls')
    .select('*')
    .eq('verification_id', id)
    .order('created_at', { ascending: false })
  if (callsErr) throw new Error(`Could not load AI calls: ${callsErr.message}`)
  const calls = (callRows ?? []) as AiCall[]
  const activeCall = calls.find(c => ACTIVE_STATUSES.includes(c.status)) ?? null
  const draft = calls.find(c => c.status === 'draft') ?? null

  const coi = (v.coi_extracted ?? null) as COIExtracted | null
  const config = await getCallConfig(v.org_id as string | null)
  const prefill = draftFromVerification({
    displayId: String(v.display_id ?? ''),
    agentQuestions: v.agent_questions,
    coi,
    contactChecks: (Array.isArray(v.contact_checks) ? v.contact_checks : []) as ContactCheckEntry[],
    insuranceContact: (v.insurance_contact ?? null) as { name?: string; phone?: string; email?: string } | null,
    config,
  })
  // A saved draft overrides the fresh prefill (its own edits win). Reference
  // details ride inside draft_input as details_json (no schema change).
  const draftInput = (draft?.draft_input ?? null) as (Partial<CallContextFields> & { details_json?: string }) | null
  const draftDetailsJson = draftInput?.details_json
  // Only known fields survive the merge: drafts saved before a schema change
  // may carry retired keys (vin, policy_numbers, ...) that must not leak back.
  const draftContext: Partial<CallContextFields> = {}
  if (draftInput) {
    for (const name of CONTEXT_FIELD_NAMES) {
      const v = (draftInput as Record<string, unknown>)[name]
      if (typeof v === 'string') (draftContext as Record<string, string>)[name] = v
    }
  }
  const context: CallContextFields = draftInput
    ? { ...prefill.context, ...draftContext }
    : prefill.context
  const questions = draft?.questions?.length ? draft.questions : prefill.questions
  const details = (() => {
    if (!draftDetailsJson) return prefill.details
    try {
      const parsed = JSON.parse(draftDetailsJson)
      return Array.isArray(parsed) ? parsed : prefill.details
    } catch {
      return prefill.details
    }
  })()
  const caseIsClosed = !!v.published_at || v.case_status === 'failed'
  const orgName = (v.orgs as { name?: string } | null)?.name ?? ''

  return (
    <div>
      <Link href={`/admin/${id}`} style={{ fontSize: 13, color: C.txt2, textDecoration: 'none' }}>
        &larr; Back to {String(v.display_id ?? 'verification')}
      </Link>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '10px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 500, margin: 0 }}>AI call review</h1>
        <span style={{ fontSize: 13.5, color: C.txt3 }}>
          {String(v.display_id ?? '')}{orgName ? ` · ${orgName}` : ''}{v.carrier_name ? ` · ${String(v.carrier_name)}` : ''}
        </span>
      </div>
      <p style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.6, margin: '0 0 20px', maxWidth: 720 }}>
        Review and edit exactly what the agent will say and ask. Nothing is dialed until you approve this payload; the approval is recorded next to the call for the audit trail.
      </p>

      {activeCall ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13.5, color: C.txt2, margin: 0 }}>
            A call is in progress for this verification. Stop it or wait for it to end before dispatching another.
          </p>
          <LiveCallPanel
            verificationId={id}
            aiCallId={activeCall.id}
            initial={{
              status: activeCall.status,
              transcript: activeCall.transcript ?? '',
              durationMs: activeCall.duration_ms,
              startedAt: activeCall.started_at,
              error: activeCall.error,
            }}
          />
        </div>
      ) : (
        <CallReviewForm
          key={JSON.stringify({ context, questions, details, draftId: draft?.id ?? null })}
          verificationId={id}
          context={context}
          questions={questions}
          details={details}
          numbers={prefill.numbers}
          coiPhone={coi?.insurance_company_phone ?? ''}
          draftId={draft?.id ?? null}
          caseIsClosed={caseIsClosed}
        />
      )}
    </div>
  )
}
