'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { downloadDocument } from '@/lib/storage'
import { emitEvent } from '@/lib/webhooks'
import { extractCOIFields, extractTextFromFile, parseRequirements, analyzeGaps } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'

/** Run OCR/extraction on a verification's documents and store the parsed analysis. */
export async function runExtraction(verificationId: string) {
  await requireAdmin()
  const supabase = createServiceClient()
  // Admin-editable prompts + baseline checklist (/admin/configs); defaults apply when unset.
  const cfg = await getExtractionConfig()

  const { data: v } = await supabase
    .from('verifications')
    .select('id, requirements, carrier_name')
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
  // apply even when no insurance-standards document was provided.
  const gap = coiExtracted
    ? await analyzeGaps(requirements, coiExtracted as Parameters<typeof analyzeGaps>[1], {
        carrierName: (v as { carrier_name?: string } | null)?.carrier_name,
        includeBaseline: true,
        baseline: cfg.baselineRequirements,
      })
    : null

  await supabase.from('verifications').update({
    coi_extracted: coiExtracted,
    requirements_normalized: requirements,
    gap_analysis: gap,
    case_status: 'ocr_complete',
  }).eq('id', verificationId)

  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Save the insurer contact + append a timestamped call note.
 * call_notes is an append-only jsonb array: [{ at, text, contact }].
 */
export async function saveCallNote(verificationId: string, formData: FormData) {
  await requireAdmin()
  const supabase = createServiceClient()

  const insurance_contact = {
    name: String(formData.get('contact_name') || '').trim(),
    phone: String(formData.get('contact_phone') || '').trim(),
    email: String(formData.get('contact_email') || '').trim(),
  }
  const update: Record<string, unknown> = {}
  // The form clears after each save; an all-blank contact means "keep the
  // previously saved one", not "erase it".
  if (Object.values(insurance_contact).some(Boolean)) update.insurance_contact = insurance_contact

  const text = String(formData.get('note') || '').trim()
  if (text) {
    const { data: v } = await supabase
      .from('verifications')
      .select('call_notes, insurance_contact')
      .eq('id', verificationId)
      .single()
    const existing = Array.isArray(v?.call_notes) ? v.call_notes : []
    // Snapshot the contact into the note so each entry records who was spoken to,
    // even if the insurer contact fields change later. Blank form → snapshot the
    // previously saved contact.
    const snapshot = Object.values(insurance_contact).some(Boolean)
      ? insurance_contact
      : (v?.insurance_contact ?? insurance_contact)
    update.call_notes = [...existing, { at: new Date().toISOString(), text, contact: snapshot }]
  }

  if (Object.keys(update).length > 0) {
    await supabase.from('verifications').update(update).eq('id', verificationId)
  }
  revalidatePath(`/admin/${verificationId}`)
}

interface AssessmentItem {
  requirement: { coverage_type: string; minimum_limit: string; notes: string | null }
  status: 'met' | 'not_met' | 'uncertain'
  evidence: string
}

/**
 * Save the admin's requirement-by-requirement assessment (and optionally publish).
 * Writes final_report in the same { met, not_met, uncertain, narrative_summary }
 * shape the automated pipeline produces, so the customer view renders identically
 * whether the verdicts came from OCR or from the admin.
 */
export async function saveAssessment(verificationId: string, formData: FormData) {
  await requireAdmin()
  const supabase = createServiceClient()

  const count = Number(formData.get('row_count') || 0)
  const report = { met: [] as AssessmentItem[], not_met: [] as AssessmentItem[], uncertain: [] as AssessmentItem[] }
  for (let i = 0; i < count; i++) {
    let requirement: AssessmentItem['requirement']
    try {
      requirement = JSON.parse(String(formData.get(`req_${i}_requirement`) || '{}'))
    } catch {
      continue
    }
    const raw = String(formData.get(`req_${i}_status`) || 'uncertain')
    const status: AssessmentItem['status'] = raw === 'met' || raw === 'not_met' ? raw : 'uncertain'
    const evidence = String(formData.get(`req_${i}_evidence`) || '').trim()
    report[status].push({ requirement, status, evidence })
  }

  const narrative_summary = String(formData.get('narrative_summary') || '').trim()
  const publish = String(formData.get('intent') || '') === 'publish'

  const update: Record<string, unknown> = {
    final_report: { ...report, narrative_summary },
    case_status: 'report_ready',
  }
  if (publish) {
    update.status = 'completed'
    update.published_at = new Date().toISOString()
  }

  const { data: v } = await supabase.from('verifications')
    .update(update)
    .eq('id', verificationId)
    .select('id, org_id, display_id, carrier_name, status, published_at')
    .single()

  if (publish && v) {
    await emitEvent(v.org_id, 'verification.updated', {
      object: 'verification', id: v.id, display_id: v.display_id,
      carrier_name: v.carrier_name, status: v.status, published_at: v.published_at,
    })
    revalidatePath('/admin')
    redirect('/admin')
  }
  revalidatePath(`/admin/${verificationId}`)
}

export interface GrantState { ok?: boolean; error?: string }

/** Assign a registered user to an existing org. Used by the Edit User modal. */
export async function grantAccess(_prev: GrantState, formData: FormData): Promise<GrantState> {
  await requireAdmin()
  const supabase = createServiceClient()
  const profileId = String(formData.get('profile_id') || '')
  const orgId = String(formData.get('org_id') || '')
  if (!profileId || !orgId) return { error: 'Pick a user and an org.' }

  const { error } = await supabase.from('profiles').update({ org_id: orgId }).eq('id', profileId)
  if (error) return { error: error.message }
  revalidatePath('/admin/users')
  return { ok: true }
}
