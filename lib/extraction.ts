import { createServiceClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/storage'
import { extractCOIFields, extractTextFromFile, parseRequirements, parseRequirementLines, assessVerification, generateInsurerQuestions } from '@/lib/claude'
import { getExtractionConfig, getQuestionsConfig } from '@/lib/config'
import { isCuratedQuestionList } from '@/lib/call-config'
import { dispositionLabel, TERMINAL_STATUSES, type AiCall } from '@/lib/ai-call-shared'
import { applyQuestionTokens, templateVariableValues, uncoveredRequirements } from '@/lib/question-config'
import type { ContactNote, FinalReport, GapAnalysis, Requirement } from '@/lib/types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Standards/rate-con document -> plain text. Upload validation accepts pdf,
 * image, docx, and txt for standards; only pdf/image can go to Claude vision
 * (anything else as an image block is a guaranteed API 400). docx goes
 * through mammoth, txt is decoded directly — no model call needed.
 */
async function docToText(bytes: ArrayBuffer, mime: string, prompt?: string): Promise<string> {
  if (mime === 'text/plain') return Buffer.from(bytes).toString('utf-8').trim()
  if (mime === DOCX_MIME) {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return value.trim()
  }
  return extractTextFromFile(Buffer.from(bytes).toString('base64'), mime, prompt)
}

/**
 * Every requirement must surface as a requirement check: anything the gap
 * model failed to give a verdict lands in `uncertain` instead of silently
 * disappearing from the report.
 */
function ensureAllRequirementsJudged(gap: GapAnalysis, requirements: Requirement[]): GapAnalysis {
  const key = (r?: { coverage_type?: string }) => (r?.coverage_type ?? '').trim().toLowerCase()
  const judged = new Set([...gap.met, ...gap.not_met, ...gap.uncertain].map(i => key(i.requirement)))
  const missing = requirements.filter(r => !judged.has(key(r)))
  if (!missing.length) return gap
  console.error(`gap analysis dropped ${missing.length} requirement(s); adding as uncertain: ${missing.map(r => r.coverage_type).join(', ')}`)
  return {
    ...gap,
    uncertain: [
      ...gap.uncertain,
      ...missing.map(requirement => ({
        requirement,
        status: 'uncertain' as const,
        evidence: 'This standard could not be assessed automatically and needs manual review.',
      })),
    ],
  }
}

/** Insurer-call questions, best-effort: a failure here must not discard the
 *  finished extraction, so it degrades to null rather than throwing. */
async function questionsFor(
  requirements: Requirement[],
  coiExtracted: unknown,
  promptOverride?: string,
): Promise<string[] | null> {
  if (!requirements.length || !coiExtracted) return null
  try {
    return await generateInsurerQuestions(requirements, coiExtracted as Parameters<typeof generateInsurerQuestions>[1], promptOverride)
  } catch (e) {
    console.error('insurer question generation failed', e)
    return null
  }
}

/**
 * Question list from the org+template Questions List config (settings →
 * Calling) when one exists: the configured questions with per-deal {tokens}
 * substituted, plus OCR-generated questions ONLY for requirements the config
 * does not cover (template edits since the config was saved, special
 * instructions, uploaded standards docs). Null = no usable config; the caller
 * falls back to full generation. Best-effort like questionsFor: never throws.
 */
export async function questionsFromConfig(input: {
  orgId: string | null
  templateId: string | null
  /** verifications.requirements as stored — carries the per-deal variable values. */
  storedRequirements: unknown
  requirements: Requirement[]
  coiExtracted: unknown
  promptOverride?: string
}): Promise<(string | { text: string; blocker?: boolean })[] | null> {
  if (!input.orgId || !input.templateId) return null
  try {
    const config = await getQuestionsConfig(input.orgId, input.templateId)
    if (!config) return null
    const values = templateVariableValues(input.storedRequirements)
    // Object entries so the admin's configured blocker flags and ordering
    // survive verbatim (a configured list therefore counts as curated, like a
    // hand-edited one: extraction re-runs keep it; Regenerate re-applies it).
    const configured = config.questions
      .filter(q => q.question)
      .map(q => ({
        text: applyQuestionTokens(q.question, values),
        ...(q.blocker ? { blocker: true as const } : {}),
      }))
    if (!configured.length) return null
    // The config replaces generation only for the rows it covers; the rest
    // (usually none, which skips the model call entirely) still generate.
    const uncovered = uncoveredRequirements(config, input.requirements)
    const extras = uncovered.length
      ? (await questionsFor(uncovered, input.coiExtracted, input.promptOverride) ?? []).slice(1)
      : []
    // NO mandatory lead question here: a configured list is authoritative
    // (prepending the hardcoded "still active and in force?" duplicated the
    // admin's own policy-active blocker, owner report 2026-07-29). The
    // generated extras above already have theirs sliced off too.
    return [...configured, ...extras]
  } catch (e) {
    console.error('questions config lookup failed; falling back to generation', e)
    return null
  }
}

/**
 * The OCR pipeline body, callable from the admin route (which raises
 * maxDuration — Claude vision on a PDF regularly exceeds the default limit).
 * Caller must have verified admin.
 *
 * Extraction ONLY gathers context (owner decision 2026-07-27): COI fields,
 * standards text, normalized requirements, insurer call questions, and the
 * insured name. It never writes gap_analysis or final_report — the verdicts
 * + summary come from runAssessmentPipeline below, run on demand from the
 * Analysis tab once calls/logs are in.
 */
export async function runExtractionPipeline(verificationId: string): Promise<void> {
  const supabase = createServiceClient()
  // Admin-editable prompts (/admin/settings); defaults apply when unset.
  const cfg = await getExtractionConfig()

  const { data: v, error: verr } = await supabase
    .from('verifications')
    .select('id, org_id, requirements, template_id, case_status, agent_questions')
    .eq('id', verificationId)
    .single()
  if (verr || !v) throw new Error(`Could not load the verification: ${verr?.message ?? 'not found'}`)

  const { data: docs, error: derr } = await supabase
    .from('documents')
    .select('id, kind, storage_path, mime_type')
    .eq('verification_id', verificationId)
  // A failed read must abort: proceeding with an empty docs list would
  // overwrite a previously good extraction with nulls.
  if (derr) throw new Error(`Could not load documents: ${derr.message}`)

  // COI → structured fields (vision)
  const coiDoc = docs?.find(d => d.kind === 'coi')
  let coiExtracted: unknown = null
  if (coiDoc) {
    const { bytes, contentType } = await downloadDocument(coiDoc.storage_path)
    const b64 = Buffer.from(bytes).toString('base64')
    coiExtracted = await extractCOIFields(b64, coiDoc.mime_type || contentType, cfg.promptCoiExtraction)
    await supabase.from('documents')
      .update({ extracted: coiExtracted, extractor: 'claude', extraction_status: 'processed' })
      .eq('id', coiDoc.id)
  }

  // requirements: free text + rate con / requirements docs → text → parsed.
  // Two stored shapes: web submissions { text }, API submissions [{ type: 'text', value }].
  const storedReqs = v?.requirements as { text?: string } | { type?: string; value?: string }[] | null
  const manualText = (Array.isArray(storedReqs)
    ? storedReqs.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n')
    : storedReqs?.text ?? ''
  ).trim()
  // Standards docs only. "Any other relevant documents" (kind 'rcs') are NOT
  // OCR'd or parsed into requirements (owner decision 2026-07-11): until we
  // see what customers actually attach there, their content must not
  // contaminate the deal's requirements the way the old rate-con slot did.
  let docText = ''
  for (const d of (docs ?? []).filter(d => d.kind === 'requirements')) {
    const { bytes, contentType } = await downloadDocument(d.storage_path)
    const mime = d.mime_type || contentType
    const txt = await docToText(bytes, mime, cfg.promptDocTextExtraction)
    await supabase.from('documents')
      .update({ extracted: { text: txt }, extractor: mime === 'text/plain' || mime === DOCX_MIME ? 'local' : 'claude', extraction_status: 'processed' })
      .eq('id', d.id)
    docText += `\n${txt}`
  }

  // The submitter's own standards are line-structured and parse under a strict
  // one-requirement-per-line contract (with a deterministic fallback), so
  // every submitted standard is GUARANTEED its own requirement — the model may
  // not merge a "Vehicle VIN" line into a broader "Vehicle listed" line.
  // Uploaded standards documents are free-form prose and keep the open parse.
  const manualLines = manualText.split('\n').map(l => l.trim()).filter(Boolean)
  const manualReqs = manualLines.length ? await parseRequirementLines(manualLines, cfg.promptRequirementsParsing) : []
  const docReqs = docText.trim() ? await parseRequirements(docText.trim(), cfg.promptRequirementsParsing) : []
  const requirements = [...manualReqs, ...docReqs]

  const update: Record<string, unknown> = {
    coi_extracted: coiExtracted,
    requirements_normalized: requirements,
    error_detail: null,
  }
  // The deal's display name IS the policyholder: every extraction stamps
  // insured_name from the COI — named insured first, certificate holder
  // second. Displays fall back to the display id while this is blank.
  if (coiExtracted) {
    const coi = coiExtracted as { named_insured?: string; certificate_holder?: string; named_insured_address?: string }
    update.insured_name = (coi.named_insured ?? '').trim() || (coi.certificate_holder ?? '').trim() || ''
    // Second half of the business identity the Businesses pages group by.
    update.insured_address = (coi.named_insured_address ?? '').trim()
  }
  // The agent contact check is NOT run here: it costs web searches per run,
  // so it has its own button on the admin page (runContactCheck action).

  // Insurer call questions track the CURRENT standards on every run (one per
  // requirement, additions and removals included); they prefill the AI call.
  // EXCEPT once the admin has hand-edited the list (object-shaped entries):
  // curated lists are never overwritten — the AI tab's Regenerate button is
  // the explicit way back (owner decision 2026-07-28). On generation failure,
  // keep the old questions rather than wiping them.
  if (!isCuratedQuestionList(v.agent_questions)) {
    const regenerated = await questionsFromConfig({
      orgId: (v.org_id as string | null) ?? null,
      templateId: (v.template_id as string | null) ?? null,
      storedRequirements: v.requirements,
      requirements,
      coiExtracted,
      promptOverride: cfg.promptInsurerQuestions,
    }) ?? await questionsFor(requirements, coiExtracted, cfg.promptInsurerQuestions)
    if (regenerated) update.agent_questions = regenerated
  }

  // Only advance from the initial state: a case already assessed or published
  // must not fall back to "ocr_complete" because its extraction re-ran.
  if (!v.case_status || v.case_status === 'pending') update.case_status = 'ocr_complete'

  const { error: werr } = await supabase.from('verifications').update(update).eq('id', verificationId)
  // Never drop finished Claude analysis on the floor: the docs are already
  // stamped processed, so a swallowed write here leaves inconsistent state.
  if (werr) throw new Error(`Could not save the extraction results: ${werr.message}`)
}

/**
 * Serialize the insurer contact log for the assessment model: who was
 * reached, how, when, the admin's summary, and the transcript (capped so a
 * long call still fits the context).
 */
function contactLogText(notes: ContactNote[]): string {
  return notes.map(n => {
    const who = (n.contact?.name ?? '').trim() || 'Unnamed contact'
    const how = (n.contact_method ?? '').trim() || 'contact'
    const summary = (n.summary_text ?? n.text ?? '').trim()
    const transcript = (n.transcript ?? '').trim()
    const lines = [`[${n.at}] ${how} with ${who}`]
    if (summary) lines.push(`Summary: ${summary}`)
    if (transcript) lines.push(`Transcript:\n${transcript.slice(0, 8000)}`)
    return lines.join('\n')
  }).join('\n\n')
}

/**
 * Serialize the AI dialer's call attempts for the assessment model. Calls
 * that never landed (no answer, voicemail, busy, dial failed) never reach
 * call_notes — the publish gate requires a transcript or summary — so
 * without this the assessment cannot know contact was attempted and failed.
 */
function callAttemptsText(calls: Pick<AiCall, 'status' | 'disconnection_reason' | 'error' | 'created_at' | 'call_analysis'>[]): string {
  return calls.map(c => {
    const outcome = dispositionLabel(c) || c.status
    const refusal = String(c.call_analysis?.custom_analysis_data?.refusal_reason ?? '').trim()
    const bits = [`[${c.created_at}] AI phone call to the insurer: ${outcome}`]
    if (refusal && refusal.toLowerCase() !== 'none') bits.push(`Refusal reason: ${refusal}`)
    return bits.join('. ')
  }).join('\n')
}

/**
 * The Analysis-tab assessment: judge the COI against the requirements using
 * the extraction output AND the insurer contact log, then write the verdicts
 * as gap_analysis and the editable draft (rows + narrative summary) as
 * final_report. Rerunnable; each run replaces the current draft. The customer
 * sees nothing until the admin publishes. Caller must have verified admin.
 */
export async function runAssessmentPipeline(verificationId: string): Promise<void> {
  const supabase = createServiceClient()
  // Admin-editable prompt (/admin/settings); the default applies when unset.
  const cfg = await getExtractionConfig()
  const { data: v, error: verr } = await supabase
    .from('verifications')
    .select('id, coi_extracted, requirements_normalized, call_notes')
    .eq('id', verificationId)
    .single()
  if (verr || !v) throw new Error(`Could not load the verification: ${verr?.message ?? 'not found'}`)

  const requirements = (Array.isArray(v.requirements_normalized) ? v.requirements_normalized : []) as Requirement[]
  if (!v.coi_extracted) throw new Error('Run extraction first: the assessment judges the extracted COI.')
  if (!requirements.length) throw new Error('No parsed requirements to judge. Run extraction first.')

  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
  // Ended AI calls, landed or not: unanswered/voicemail/refused attempts are
  // invisible in call_notes (publish requires a transcript or summary), and
  // the summary must be able to say contact was tried and did not land.
  const { data: callRows, error: cerr } = await supabase
    .from('ai_calls')
    .select('status, disconnection_reason, error, created_at, call_analysis')
    .eq('verification_id', verificationId)
    .in('status', TERMINAL_STATUSES)
    .order('created_at', { ascending: true })
  if (cerr) throw new Error(`Could not load the AI call history: ${cerr.message}`)
  const attempts = callAttemptsText((callRows ?? []) as Parameters<typeof callAttemptsText>[0])
  const log = [contactLogText(notes), attempts ? `Call attempts (AI dialer, including ones that did not land):\n${attempts}` : '']
    .filter(Boolean).join('\n\n')
  const report = ensureAllRequirementsJudged(
    await assessVerification(requirements, v.coi_extracted as Parameters<typeof assessVerification>[1], log, cfg.promptAssessment),
    requirements,
  ) as FinalReport
  // Passed REQUIRES insurer confirmation (owner rule 2026-07-29): a standard
  // merely present on the certificate is a Warning, not a pass. Deterministic
  // guard on top of the prompt: demote any unconfirmed met item.
  const unconfirmed = report.met.filter(i => i.insurer_confirmation !== 'call' && i.insurer_confirmation !== 'email')
  if (unconfirmed.length) {
    report.met = report.met.filter(i => !unconfirmed.includes(i))
    report.uncertain = [...report.uncertain, ...unconfirmed.map(i => ({
      ...i,
      status: 'uncertain' as const,
      evidence: `${(i.evidence ?? '').trim().replace(/\.$/, '')}. Not yet confirmed with the insurer.`.replace(/^\. /, ''),
    }))]
  }

  const { error: werr } = await supabase.from('verifications').update({
    gap_analysis: { met: report.met, not_met: report.not_met, uncertain: report.uncertain },
    final_report: report,
  }).eq('id', verificationId)
  if (werr) throw new Error(`Could not save the assessment: ${werr.message}`)
}
