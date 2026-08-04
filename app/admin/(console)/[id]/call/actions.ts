'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { adminInitials } from '@/lib/admin-activity'
import { createAiVerificationCall, stopCall, configuredAgentId } from '@/lib/retell'
import {
  buildDynamicVariables, defaultQuestionsFromAgentQuestions, normalizeE164, validateDispatch,
  type AiCallQuestion, type CallContextFields, type ReferenceDetail, CONTEXT_FIELD_NAMES,
} from '@/lib/call-config'
import {
  ACTIVE_STATUSES, syncAiCall, summaryHtmlFromAnalysis,
  type AiCall,
} from '@/lib/ai-calls'
import { sanitizeSummaryHtml, summaryPlainText } from '@/lib/sanitize-note'
import { formatTranscriptText } from '@/lib/call-transcript'
import { contactValue, noteCheckFromRegistry } from '@/lib/contact-notes'
import { generateInsurerQuestions } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'
import { questionsFromConfig } from '@/lib/extraction'
import { recordEvent } from '@/lib/webhooks'
import type { COIExtracted, ContactCheckEntry, Requirement } from '@/lib/types'

/**
 * AI call dispatch actions (voice spec v5 §10). Every mutation here begins
 * with requireAdmin(): initiating, stopping, and publishing AI calls are
 * admin-only, full stop. approveAndDispatchCall is the ONLY code path that
 * hands a payload to Retell, and it re-runs the §10 validation server-side —
 * the client form's validation is a courtesy copy, never the gate.
 */

/** Same closed-case rule as the main admin actions: published or failed = read-only. */
async function caseClosed(supabase: ReturnType<typeof createServiceClient>, verificationId: string): Promise<boolean> {
  const { data } = await supabase.from('verifications')
    .select('published_at, case_status')
    .eq('id', verificationId)
    .maybeSingle()
  return !!data && (!!data.published_at || data.case_status === 'failed')
}

const CLOSED_ERROR = 'This case is closed. Click Edit Status in the Assessment section to reopen it first.'

function parseContext(formData: FormData): CallContextFields {
  const ctx = {} as Record<string, string>
  for (const name of CONTEXT_FIELD_NAMES) {
    ctx[name] = String(formData.get(name) ?? '').trim()
  }
  const fields = ctx as unknown as CallContextFields
  fields.call_context = ctx.call_context === 'resumed' ? 'resumed' : 'new'
  return fields
}

function parseDetails(formData: FormData): ReferenceDetail[] | null {
  try {
    const raw = JSON.parse(String(formData.get('details_json') || '[]'))
    if (!Array.isArray(raw)) return null
    return raw
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map(d => ({ label: String(d.label ?? '').trim(), value: String(d.value ?? '').trim() }))
      .filter(d => d.label || d.value)
  } catch {
    return null
  }
}

function parseQuestions(formData: FormData): AiCallQuestion[] | null {
  try {
    const raw = JSON.parse(String(formData.get('questions_json') || '[]'))
    if (!Array.isArray(raw)) return null
    return raw
      .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
      .map((q): AiCallQuestion => {
        const fu = (q.followUp ?? null) as { condition?: unknown; text?: unknown } | null
        const condition = String(fu?.condition ?? '').trim()
        const fuText = String(fu?.text ?? '').trim()
        return {
          text: String(q.text ?? '').trim(),
          ...(q.blocker === true ? { blocker: true } : {}),
          ...(condition && fuText ? { followUp: { condition, text: fuText } } : {}),
        }
      })
      .filter(q => q.text)
  } catch {
    return null
  }
}

async function logActivity(
  supabase: ReturnType<typeof createServiceClient>,
  verificationId: string,
  adminEmail: string,
  kind: 'called' | 'note',
  note: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_append_activity', {
    vid: verificationId,
    kind,
    actor: adminInitials(adminEmail),
    note,
  })
  if (error) console.error('ai-call activity log failed', error)
}

/**
 * Persist the master question list on the verification itself (the AI tab's
 * editor). Curated lists are stored as {text, blocker} objects — the shape
 * itself marks them hand-edited, so runExtractionPipeline stops regenerating
 * over them. Dispatch reads THIS list at dial time (the pre-dial modal does
 * not edit questions), so a saved edit reaches every future call.
 */
export async function saveAgentQuestions(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const questions = parseQuestions(formData)
  if (!questions) return { error: 'Could not read the question list. Please retry.' }
  const { error } = await supabase.from('verifications')
    .update({ agent_questions: questions })
    .eq('id', verificationId)
  if (error) {
    console.error('saveAgentQuestions failed', error)
    return { error: 'Could not save the questions. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Rebuild the question list from the CURRENT standards + COI, discarding any
 * hand edits (the editor confirms first). Writes the generated string[] shape,
 * so extraction re-runs resume keeping it current.
 */
export async function regenerateAgentQuestions(verificationId: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const { data: v, error } = await supabase.from('verifications')
    .select('requirements_normalized, coi_extracted, org_id, template_id, requirements')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) return { error: 'Could not load this verification. Please retry.' }
  const requirements = (Array.isArray(v.requirements_normalized) ? v.requirements_normalized : []) as Requirement[]
  try {
    const cfg = await getExtractionConfig()
    // Same source order as extraction: the org+template Questions List config
    // first, full OCR generation only when no config covers this deal.
    const questions = await questionsFromConfig({
      orgId: (v.org_id as string | null) ?? null,
      templateId: (v.template_id as string | null) ?? null,
      storedRequirements: v.requirements,
      requirements,
      coiExtracted: v.coi_extracted ?? null,
      promptOverride: cfg.promptInsurerQuestions,
    }) ?? await generateInsurerQuestions(requirements, (v.coi_extracted ?? null) as COIExtracted | null, cfg.promptInsurerQuestions)
    const { error: werr } = await supabase.from('verifications')
      .update({ agent_questions: questions })
      .eq('id', verificationId)
    if (werr) throw werr
  } catch (e) {
    console.error('regenerateAgentQuestions failed', e)
    return { error: 'Could not regenerate the questions. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * The master question list as it will dial: loaded from the verification and
 * normalized (blockers first). Server-authoritative — the modal never sends
 * questions, so a master-list edit always reaches the next dispatch.
 */
async function loadAgentQuestions(
  supabase: ReturnType<typeof createServiceClient>,
  verificationId: string,
): Promise<AiCallQuestion[] | null> {
  const { data, error } = await supabase.from('verifications')
    .select('agent_questions')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !data) return null
  return defaultQuestionsFromAgentQuestions(data.agent_questions)
}

/** Save the review form as the verification's draft (one draft row per verification). */
export async function saveCallDraft(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const context = parseContext(formData)
  const details = parseDetails(formData)
  if (!details) return { error: 'Could not read the reference details. Please retry.' }
  const questions = await loadAgentQuestions(supabase, verificationId)
  if (!questions) return { error: 'Could not load the question list. Please retry.' }
  const toNumber = String(formData.get('to_number') || '').trim()
  const numberSource = String(formData.get('number_source') || 'manual')

  const { data: existing } = await supabase.from('ai_calls')
    .select('id')
    .eq('verification_id', verificationId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = {
    verification_id: verificationId,
    created_by: adminInitials(admin.email ?? ''),
    status: 'draft',
    to_number: toNumber,
    number_source: numberSource,
    questions,
    // Reference details ride inside draft_input so the draft round-trips
    // without a schema change; the review page splits them back out.
    draft_input: { ...context, details_json: JSON.stringify(details) } as unknown as Record<string, string>,
    updated_at: new Date().toISOString(),
  }
  const { error } = existing
    ? await supabase.from('ai_calls').update(row).eq('id', existing.id)
    : await supabase.from('ai_calls').insert(row)
  if (error) {
    console.error('saveCallDraft failed', error)
    return { error: 'Could not save the draft. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/** Reject the current draft with a reason (kept for the §10 audit trail). */
export async function rejectCallDraft(verificationId: string, draftId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const reason = String(formData.get('rejected_reason') || '').trim()
  if (!reason) return { error: 'Write the reason before rejecting.' }
  const { error } = await supabase.from('ai_calls')
    .update({ status: 'rejected', rejected_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('verification_id', verificationId)
    .eq('status', 'draft')
  if (error) {
    console.error('rejectCallDraft failed', error)
    return { error: 'Could not reject the draft. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * The §10 gate: validate the exact payload, freeze it with the approver's
 * identity, then dispatch to Retell. A dispatch failure keeps the frozen
 * payload and the error on the row — the attempt is part of the audit trail.
 */
export async function approveAndDispatchCall(verificationId: string, formData: FormData): Promise<{ error?: string; callId?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const context = parseContext(formData)
  const details = parseDetails(formData)
  if (!details) return { error: 'Could not read the reference details. Please retry.' }
  const questions = await loadAgentQuestions(supabase, verificationId)
  if (!questions) return { error: 'Could not load the question list. Please retry.' }
  const toNumberRaw = String(formData.get('to_number') || '').trim()
  const numberSource = String(formData.get('number_source') || 'manual')

  // Server-side validation: hard blocks refuse the dispatch outright.
  const { blocks } = validateDispatch({ context, questions, details, toNumber: toNumberRaw })
  if (blocks.length) return { error: blocks.join(' ') }
  const toNumber = normalizeE164(toNumberRaw)!

  const agentId = configuredAgentId()
  if (!agentId || !process.env.RETELL_FROM_NUMBER) {
    return { error: 'Retell is not configured (agent id or from number missing). Check the environment settings.' }
  }

  // One in-flight call per verification: a second dial while the first is
  // live would talk over the same office.
  const { data: active } = await supabase.from('ai_calls')
    .select('id')
    .eq('verification_id', verificationId)
    .in('status', ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle()
  if (active) return { error: 'A call for this verification is already in progress. Stop it or wait for it to end.' }

  const payload = buildDynamicVariables(context, questions, details)
  const { data: display } = await supabase.from('verifications')
    .select('display_id').eq('id', verificationId).maybeSingle()

  // Freeze the approved payload FIRST: the audit record exists even if the
  // Retell request dies. Reuse the draft row when there is one.
  const { data: draft } = await supabase.from('ai_calls')
    .select('id')
    .eq('verification_id', verificationId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const approvedRow = {
    verification_id: verificationId,
    created_by: adminInitials(admin.email ?? ''),
    status: 'approved',
    to_number: toNumber,
    number_source: numberSource,
    questions,
    draft_input: { ...context, details_json: JSON.stringify(details) } as unknown as Record<string, string>,
    payload,
    approved_by: admin.email ?? '',
    approved_at: new Date().toISOString(),
    retell_agent_id: agentId,
    updated_at: new Date().toISOString(),
  }
  const { data: saved, error: saveErr } = draft
    ? await supabase.from('ai_calls').update(approvedRow).eq('id', draft.id).select('id').single()
    : await supabase.from('ai_calls').insert(approvedRow).select('id').single()
  if (saveErr || !saved) {
    console.error('approveAndDispatchCall: approval write failed', saveErr)
    return { error: 'Could not record the approval. Nothing was dialed. Please retry.' }
  }

  await logActivity(supabase, verificationId, admin.email ?? '', 'called',
    `AI call dispatched to ${toNumber}${display?.display_id ? ` (${display.display_id})` : ''}`)

  try {
    const retellCallId = await createAiVerificationCall({ toNumber, variables: payload })
    const { error } = await supabase.from('ai_calls')
      .update({ status: 'dispatched', retell_call_id: retellCallId, updated_at: new Date().toISOString() })
      .eq('id', saved.id)
    if (error) console.error('approveAndDispatchCall: dispatched update failed', error)
      revalidatePath(`/admin/${verificationId}`)
    return { callId: saved.id }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    await supabase.from('ai_calls')
      .update({ status: 'failed', error: detail.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', saved.id)
      revalidatePath(`/admin/${verificationId}`)
    return { error: `The call could not be placed: ${detail}` }
  }
}

/** Kill switch: end an in-flight call now. The status settles via the next sync. */
export async function stopAiCall(verificationId: string, aiCallId: string): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  const { data: row, error } = await supabase.from('ai_calls')
    .select('*')
    .eq('id', aiCallId)
    .eq('verification_id', verificationId)
    .maybeSingle()
  if (error || !row) return { error: 'Could not load this call. Please retry.' }
  const call = row as AiCall
  if (!ACTIVE_STATUSES.includes(call.status) || !call.retell_call_id) {
    return { error: 'This call is not in progress.' }
  }
  await supabase.from('ai_calls')
    .update({ stopped_by: admin.email ?? '', updated_at: new Date().toISOString() })
    .eq('id', aiCallId)
  try {
    await stopCall(call.retell_call_id)
  } catch (e) {
    console.error('stopAiCall: stop failed', e)
    return { error: 'Retell did not accept the stop request. Please retry.' }
  }
  await syncAiCall(supabase, { ...call, stopped_by: admin.email ?? '' })
  await logActivity(supabase, verificationId, admin.email ?? '', 'note', 'AI call stopped by admin')
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Publish the AI call's summary + transcript into the Insurer Contact Log.
 * The result is an ordinary contact note: editable and deletable through the
 * existing note UI, customer-visible only via the existing publish gating.
 */
export async function publishAiCallNote(verificationId: string, aiCallId: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const { data: row, error } = await supabase.from('ai_calls')
    .select('*')
    .eq('id', aiCallId)
    .eq('verification_id', verificationId)
    .maybeSingle()
  if (error || !row) return { error: 'Could not load this call. Please retry.' }
  const call = row as AiCall
  if (call.published_note_at) return { error: 'This call is already in the contact log.' }
  if (!call.transcript && !call.call_analysis?.call_summary) {
    return { error: 'Nothing to publish yet: the call has no transcript or summary.' }
  }

  const summary_html = sanitizeSummaryHtml(summaryHtmlFromAnalysis(call.call_analysis))
  const summary_text = summaryPlainText(summary_html)

  const { data: v } = await supabase.from('verifications')
    .select('insurance_contact, contact_checks, org_id, display_id')
    .eq('id', verificationId)
    .maybeSingle()
  const savedContact = (v?.insurance_contact ?? {}) as { name?: string; phone?: string; email?: string }
  const responder = String(call.call_analysis?.custom_analysis_data?.responder_name ?? '').trim()
  const contact = {
    name: responder || savedContact.name || '',
    phone: call.to_number ?? '',
    email: '',
  }
  const rawChecks = v?.contact_checks
  const check_data = noteCheckFromRegistry(
    (Array.isArray(rawChecks) ? rawChecks : []) as ContactCheckEntry[],
    contactValue(contact.phone),
    '',
  )

  const { error: werr } = await supabase.rpc('admin_publish_ai_call_note', {
    p_call_id: aiCallId,
    contact_method: 'call',
    summary_html,
    summary_text,
    // The note's transcript is what the customer page renders (pre-wrap):
    // prefer the readable structured rendering (timestamps, keypad presses,
    // hold gaps) over Retell's flat interleaved string.
    transcript: call.transcript_detail?.length ? formatTranscriptText(call.transcript_detail) : (call.transcript ?? ''),
    contact,
    check_data,
    agent: 'ai',
  })
  if (werr) {
    console.error('publishAiCallNote failed', werr)
    return { error: 'Could not publish to the contact log. Please retry.' }
  }
  // Published AI calls land in the Activity feed too (feed-only insert).
  if (v?.org_id) {
    await recordEvent(v.org_id as string, 'call.made',
      { id: verificationId, display_id: v.display_id }, verificationId)
  }
  revalidatePath(`/admin/${verificationId}`)
}
