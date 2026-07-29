import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { runExtractionPipeline } from '@/lib/extraction'
import { performContactCheck } from '@/lib/contact-check'
import { contactValue } from '@/lib/contact-notes'
import type { COIExtracted } from '@/lib/types'

type ServiceClient = ReturnType<typeof createServiceClient>
type ClaimColumn = 'auto_ocr_claimed_at' | 'auto_contact_claimed_at'

/**
 * Claim one auto step with a single atomic conditional UPDATE: only the call
 * that flips the column from NULL wins. Returns false when the step was
 * already claimed OR the claim query itself errored — fail CLOSED, a step
 * must never run without holding its claim. Claims are never reset (a failed
 * run is recovered via the admin Rerun buttons), so at most one auto attempt
 * of each step can ever start per verification, no matter how many times the
 * creation hook fires.
 */
async function claimStep(supabase: ServiceClient, verificationId: string, column: ClaimColumn): Promise<boolean> {
  const { data, error } = await supabase.from('verifications')
    .update({ [column]: new Date().toISOString() })
    .eq('id', verificationId)
    .is(column, null)
    .select('id')
  if (error) {
    console.error(`auto-checks: ${column} claim failed`, error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * One-time background run for a freshly created verification: OCR extraction,
 * then the online contact check on the insurer phone/email the extraction
 * found. Deliberately NEVER the analysis step (that involves placing calls).
 * Runs inside after() from createVerification, so it must never throw; every
 * failure is recorded (error_detail / console) and left for the admin's
 * Rerun buttons. Sandbox /v1 rows never reach here (autoChecks: false).
 */
export async function runAutoChecks(verificationId: string): Promise<void> {
  // Always the service client: by after() time the creating request (and any
  // RLS session client it held) is gone, and the analysis columns are only
  // writable with service role anyway.
  const supabase = createServiceClient()

  if (!(await claimStep(supabase, verificationId, 'auto_ocr_claimed_at'))) return
  try {
    await runExtractionPipeline(verificationId)
  } catch (e) {
    // Same shape/cap as the manual runExtraction action, with an `auto`
    // prefix so the admin can tell which path died. No retry: the claim is
    // burned and the Rerun button is the recovery.
    const detail = e instanceof Error ? e.message : String(e)
    await supabase.from('verifications')
      .update({ error_detail: `auto extraction failed: ${detail}`.slice(0, 500) })
      .eq('id', verificationId)
      .then(() => {}, () => {})
    return
  }

  if (!(await claimStep(supabase, verificationId, 'auto_contact_claimed_at'))) return
  const { data: v, error } = await supabase.from('verifications')
    .select('coi_extracted')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('auto-checks: coi_extracted read failed', error)
    return
  }
  // Mirror exactly what the admin UI prefills for the manual button: the
  // producer/insurer names as the search subject, the INSURER phone/email as
  // the values to verify. Missing pieces = silent no-op (the claim stays
  // consumed by design; the admin's button covers the case).
  const coi = (v.coi_extracted ?? null) as COIExtracted | null
  const producer = (coi?.producer ?? '').trim()
  const insurer = (coi?.insurance_company ?? '').trim()
  const phone = contactValue(coi?.insurance_company_phone)
  const email = contactValue(coi?.insurance_company_email)
  if ((!producer && !insurer) || (!phone && !email)) return

  const res = await performContactCheck(supabase, verificationId, { producer, insurer, phone, email })
  if (res?.error) console.error('auto-checks: contact check failed:', res.error)
}
