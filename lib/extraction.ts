import { createServiceClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/storage'
import { extractCOIFields, extractTextFromFile, parseRequirements, analyzeGaps } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'

/**
 * The OCR/analysis pipeline body, callable from the admin route (which raises
 * maxDuration — Claude vision on a PDF regularly exceeds the default limit).
 * Caller must have verified admin.
 */
export async function runExtractionPipeline(verificationId: string): Promise<void> {
  const supabase = createServiceClient()
  // Admin-editable prompts + baseline checklist (/admin/configs); defaults apply when unset.
  const cfg = await getExtractionConfig()

  const { data: v } = await supabase
    .from('verifications')
    .select('id, requirements, carrier_name, template_id')
    .eq('id', verificationId)
    .single()
  const { data: docs } = await supabase
    .from('documents')
    .select('id, kind, storage_path, mime_type')
    .eq('verification_id', verificationId)

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
  for (const d of (docs ?? []).filter(d => d.kind === 'requirements' || d.kind === 'rcs')) {
    const { bytes, contentType } = await downloadDocument(d.storage_path)
    const txt = await extractTextFromFile(Buffer.from(bytes).toString('base64'), d.mime_type || contentType, cfg.promptDocTextExtraction)
    await supabase.from('documents')
      .update({ extracted: { text: txt }, extractor: 'claude', extraction_status: 'processed' })
      .eq('id', d.id)
    reqText += `\n${txt}`
  }

  const requirements = reqText.trim() ? await parseRequirements(reqText, cfg.promptRequirementsParsing) : []
  // Always run the analysis when a COI was extracted: the baseline broker checks
  // apply even when no insurance-standards document was provided. Template-based
  // submissions carry their own checklist (templates start pre-filled with the
  // baseline rows on /app/settings), so the global baseline is not re-merged.
  const fromTemplate = !!(v as { template_id?: string } | null)?.template_id
  const gap = coiExtracted
    ? await analyzeGaps(requirements, coiExtracted as Parameters<typeof analyzeGaps>[1], {
        carrierName: (v as { carrier_name?: string } | null)?.carrier_name,
        includeBaseline: !fromTemplate,
        baseline: cfg.baselineRequirements,
      })
    : null

  await supabase.from('verifications').update({
    coi_extracted: coiExtracted,
    requirements_normalized: requirements,
    gap_analysis: gap,
    case_status: 'ocr_complete',
  }).eq('id', verificationId)
}
