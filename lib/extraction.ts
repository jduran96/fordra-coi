import { createServiceClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/storage'
import { extractCOIFields, extractTextFromFile, parseRequirements, parseRequirementLines, analyzeGaps, generateInsurerQuestions } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'
import type { GapAnalysis, Requirement } from '@/lib/types'

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
 * What a re-run does to the verification's assessment (the requirement-check
 * verdicts + summary the customer reads):
 * - 'refresh' (default): regenerate gap_analysis + insurer questions; the
 *   admin's final_report is left alone. Original behavior.
 * - 'keep': re-extract the documents (COI fields incl. locations, standards
 *   text) but do NOT touch an existing assessment — gap_analysis, insurer
 *   questions, and final_report all stay. When there is no assessment yet,
 *   behaves like 'refresh' (there is nothing to keep).
 * - 'overwrite': regenerate gap_analysis + questions AND clear the admin's
 *   final_report, so the fresh automated verdicts become the visible copy.
 */
export type AssessmentMode = 'refresh' | 'keep' | 'overwrite'

const hasItems = (g: unknown): boolean => {
  const gg = g as { met?: unknown[]; not_met?: unknown[]; uncertain?: unknown[] } | null
  return !!gg && [(gg.met ?? []), (gg.not_met ?? []), (gg.uncertain ?? [])].some(a => Array.isArray(a) && a.length > 0)
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
  gap: GapAnalysis | null,
  coiExtracted: unknown,
): Promise<string[] | null> {
  if (!requirements.length || !coiExtracted) return null
  try {
    return await generateInsurerQuestions(requirements, gap, coiExtracted as Parameters<typeof generateInsurerQuestions>[2])
  } catch (e) {
    console.error('insurer question generation failed', e)
    return null
  }
}

/**
 * The OCR/analysis pipeline body, callable from the admin route (which raises
 * maxDuration — Claude vision on a PDF regularly exceeds the default limit).
 * Caller must have verified admin.
 */
export async function runExtractionPipeline(
  verificationId: string,
  opts: { assessment?: AssessmentMode } = {},
): Promise<void> {
  const supabase = createServiceClient()
  // Admin-editable prompts (/admin/settings); defaults apply when unset.
  const cfg = await getExtractionConfig()

  const { data: v, error: verr } = await supabase
    .from('verifications')
    .select('id, requirements, carrier_name, template_id, gap_analysis, final_report')
    .eq('id', verificationId)
    .single()
  if (verr || !v) throw new Error(`Could not load the verification: ${verr?.message ?? 'not found'}`)

  // 'keep' only means something when an assessment exists to keep.
  const keepAssessment = opts.assessment === 'keep' && (hasItems(v.gap_analysis) || hasItems(v.final_report))
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

  if (!keepAssessment) {
    // A kept assessment also keeps its case_status (a published case must not
    // fall back to "ocr_complete" just because its extraction was refreshed).
    update.case_status = 'ocr_complete'
    // Requirements are entirely org-owned: templates and submitted standards carry
    // the full checklist (including condition rows); nothing is merged in globally.
    const gap = coiExtracted && requirements.length
      ? ensureAllRequirementsJudged(
          await analyzeGaps(requirements, coiExtracted as Parameters<typeof analyzeGaps>[1], v.carrier_name),
          requirements,
        )
      : null
    update.gap_analysis = gap
    update.agent_questions = await questionsFor(requirements, gap, coiExtracted)
    // Overwrite: the fresh automated verdicts become the visible copy, so the
    // admin's previous manual assessment (checks + summary) is dropped.
    if (opts.assessment === 'overwrite') update.final_report = null
  } else {
    // The assessment is kept, but the insurer questions must still track the
    // CURRENT standards (one question per requirement, additions and removals
    // included), grounded in the kept verdicts. On failure, keep the old
    // questions rather than wiping them.
    const regenerated = await questionsFor(requirements, (v.gap_analysis ?? null) as GapAnalysis | null, coiExtracted)
    if (regenerated) update.agent_questions = regenerated
  }

  const { error: werr } = await supabase.from('verifications').update(update).eq('id', verificationId)
  // Never drop finished Claude analysis on the floor: the docs are already
  // stamped processed, so a swallowed write here leaves inconsistent state.
  if (werr) throw new Error(`Could not save the extraction results: ${werr.message}`)
}
