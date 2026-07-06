import { authenticateRequest, unauthorized, apiError, serializeVerification } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { emitEvent } from '@/lib/webhooks'

export const maxDuration = 60

/** Canned result returned immediately for sandbox (sk_test_) verifications. */
function sandboxResult() {
  return {
    coi_extracted: {
      named_insured: 'ACME Trucking LLC (sandbox)',
      named_insured_address: '4820 Freight Line Rd, Dallas, TX 75207',
      named_insured_phone: '(214) 555-0182',
      named_insured_email: 'dispatch@acmetrucking.example',
      usdot_number: '3456789',
      mc_number: '987654',
      producer: 'Sample Insurance Agency Inc',
      insurance_company: 'Sample Mutual Insurance Company',
      insurance_company_address: '100 Sample Plaza, Suite 400, Hartford, CT 06103',
      insurance_company_phone: '(860) 555-0144',
      insurance_company_email: 'certificates@samplemutual.example',
      insurance_company_contact: 'Dana Whitfield',
      certificate_holder: 'Fordra Testing',
      additional_insured: '',
      additional_terms:
        'Coverage applies to owned, hired and non-owned autos while in the business of the named insured. '
        + 'Motor truck cargo subject to a $1,000 deductible per occurrence; unattended vehicle losses covered only while the vehicle is locked and parked in a secured lot. '
        + 'Commodities excluded: jewelry, currency, live animals. Thirty (30) days written notice of cancellation will be provided to the certificate holder, ten (10) days for non-payment of premium.',
      coverages: [
        { type: 'Automobile Liability', policy_number: 'SAMP-AL-000123', effective_date: '01/01/2026', expiration_date: '01/01/2027', each_occurrence_limit: '$1,000,000', aggregate_limit: '' },
        { type: 'Motor Truck Cargo', policy_number: 'SAMP-MC-000456', effective_date: '01/01/2026', expiration_date: '01/01/2027', each_occurrence_limit: '$100,000', aggregate_limit: '' },
      ],
    },
    requirements_normalized: [
      { key: 'auto_liability', min_each_occurrence: '$1,000,000', stated: true },
      { key: 'cargo', min_limit: '$100,000', stated: true },
    ],
    gap_analysis: {
      met: [
        { requirement: { coverage_type: 'Matching Policyholder Name', minimum_limit: '' },
          status: 'met', evidence: 'Sandbox: the carrier name matches the named insured on the certificate.' },
        { requirement: { coverage_type: 'Policy Date Coverage', minimum_limit: '' },
          status: 'met', evidence: 'Sandbox: all listed policies are in force today, effective 01/01/2026 through 01/01/2027.' },
        { requirement: { coverage_type: 'Automobile Liability', minimum_limit: '$1,000,000' },
          status: 'met', evidence: 'Sandbox: the policy meets the $1,000,000 requirement.' },
        { requirement: { coverage_type: 'Cargo', minimum_limit: '$100,000' },
          status: 'met', evidence: 'Sandbox: the policy meets the $100,000 requirement.' },
      ],
      not_met: [],
      uncertain: [],
    },
    final_report: {
      met: [], not_met: [], uncertain: [],
      narrative_summary:
        'Sandbox result: ACME Trucking LLC meets the submitted insurance standards. The policyholder name matches, all policies are currently in force, and Automobile Liability and Cargo limits satisfy the required minimums. This is sample data, no documents were reviewed and no agent was called.',
    },
  }
}

/**
 * POST /v1/verifications — start a verification in one multipart call.
 * Fields: carrier_name, broker_name (text); coi, rate_confirmation (files);
 * insurance_standards (text OR file). Each submission is self-contained.
 */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return unauthorized()

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('multipart/form-data')) {
    return apiError('Send this request as multipart/form-data.')
  }
  const form = await request.formData()

  const carrierName = String(form.get('carrier_name') || '').trim()
  const brokerName = String(form.get('broker_name') || '').trim()
  if (!carrierName) return apiError('`carrier_name` is required.')
  if (!brokerName) return apiError('`broker_name` is required.')

  const coi = form.get('coi')
  if (!(coi instanceof File) || coi.size === 0) return apiError('`coi` document is required.')

  const files: { file: File; kind: string }[] = [{ file: coi, kind: 'coi' }]

  const rcs = form.get('rate_confirmation')
  if (rcs instanceof File && rcs.size > 0) files.push({ file: rcs, kind: 'rcs' })

  // insurance_standards is required, sent as a file or a plain text string.
  const standards = form.get('insurance_standards')
  let requirements: unknown = null
  if (standards instanceof File && standards.size > 0) {
    files.push({ file: standards, kind: 'requirements' })
  } else if (typeof standards === 'string' && standards.trim()) {
    requirements = [{ type: 'text', value: standards.trim() }]
  } else {
    return apiError('`insurance_standards` is required. Send it as a text string or a file.')
  }

  const autoCall = String(form.get('auto_call') || '') === 'true'

  const svc = createServiceClient()
  const verificationFiles: VerificationFile[] = []
  for (const { file, kind } of files) {
    verificationFiles.push({
      bytes: await file.arrayBuffer(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      kind: kind as VerificationFile['kind'],
    })
  }

  let v: Record<string, unknown>, docRefs
  try {
    ({ verification: v, docRefs } = await createVerification(svc, {
      orgId: auth.orgId,
      carrierName,
      verifierCompany: brokerName,
      source: 'api',
      requirements,
      autoCall,
      files: verificationFiles,
    }))
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Could not create verification.', 500, 'api_error')
  }

  // Sandbox: resolve instantly with a canned result and fire the webhook.
  if (auth.mode === 'sandbox') {
    const { data: done } = await svc.from('verifications').update({
      status: 'completed',
      published_at: new Date().toISOString(),
      case_status: 'report_ready',
      ...sandboxResult(),
    }).eq('id', v.id).select('*').single()
    const final = done ?? v
    await emitEvent(auth.orgId, 'verification.updated', serializeVerification(final, docRefs))
    return Response.json(serializeVerification(final, docRefs), { status: 201 })
  }

  await emitEvent(auth.orgId, 'verification.created', serializeVerification(v, docRefs))
  return Response.json(serializeVerification(v, docRefs), { status: 201 })
}

/** GET /v1/verifications — list the org's verifications. */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return unauthorized()

  const svc = createServiceClient()
  const { data } = await svc.from('verifications')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })
    .limit(100)

  return Response.json({ object: 'list', data: (data ?? []).map(v => serializeVerification(v)) })
}
