import { createServiceClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/storage'
import { extractCOIFields, extractTextFromFile, parseRequirements, analyzeGaps } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'

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
 * The OCR/analysis pipeline body, callable from the admin route (which raises
 * maxDuration — Claude vision on a PDF regularly exceeds the default limit).
 * Caller must have verified admin.
 */
export async function runExtractionPipeline(verificationId: string): Promise<void> {
  const supabase = createServiceClient()
  // Admin-editable prompts (/admin/settings); defaults apply when unset.
  const cfg = await getExtractionConfig()

  const { data: v, error: verr } = await supabase
    .from('verifications')
    .select('id, requirements, carrier_name, template_id')
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
  let reqText = (Array.isArray(storedReqs)
    ? storedReqs.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n')
    : storedReqs?.text ?? ''
  ).trim()
  // Standards docs only. "Any other relevant documents" (kind 'rcs') are NOT
  // OCR'd or parsed into requirements (owner decision 2026-07-11): until we
  // see what customers actually attach there, their content must not
  // contaminate the deal's requirements the way the old rate-con slot did.
  for (const d of (docs ?? []).filter(d => d.kind === 'requirements')) {
    const { bytes, contentType } = await downloadDocument(d.storage_path)
    const mime = d.mime_type || contentType
    const txt = await docToText(bytes, mime, cfg.promptDocTextExtraction)
    await supabase.from('documents')
      .update({ extracted: { text: txt }, extractor: mime === 'text/plain' || mime === DOCX_MIME ? 'local' : 'claude', extraction_status: 'processed' })
      .eq('id', d.id)
    reqText += `\n${txt}`
  }

  const requirements = reqText.trim() ? await parseRequirements(reqText, cfg.promptRequirementsParsing) : []
  // Requirements are entirely org-owned: templates and submitted standards carry
  // the full checklist (including condition rows); nothing is merged in globally.
  const gap = coiExtracted && requirements.length
    ? await analyzeGaps(requirements, coiExtracted as Parameters<typeof analyzeGaps>[1])
    : null

  const { error: werr } = await supabase.from('verifications').update({
    coi_extracted: coiExtracted,
    requirements_normalized: requirements,
    gap_analysis: gap,
    case_status: 'ocr_complete',
    error_detail: null,
  }).eq('id', verificationId)
  // Never drop finished Claude analysis on the floor: the docs are already
  // stamped processed, so a swallowed write here leaves inconsistent state.
  if (werr) throw new Error(`Could not save the extraction results: ${werr.message}`)
}
