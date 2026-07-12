import { authenticateRequest, unauthorized, apiError, serializeVerification } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { resolveTemplate, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'
import { emitEvent } from '@/lib/webhooks'
import { validateUpload, UPLOAD_ALLOW, UPLOAD_MAX_BYTES } from '@/lib/upload-validation'
import { isDocumentUrl, fetchRemoteDocument } from '@/lib/remote-docs'
import { rateLimitAllows } from '@/lib/rate-limit'

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
 * Fields: carrier_name, broker_name (text); coi (file or https link);
 * additional_documents (files or https links, repeatable, up to 5);
 * insurance_standards (text, file, or https link). Links are downloaded
 * server-side, so they dodge Vercel's ~4.5MB request-body cap — that is the
 * documented "attach it, or paste a link if it's big" story on /app/docs.
 * Each submission is self-contained.
 */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return unauthorized()
  if (!await rateLimitAllows(`v1_create:${auth.orgId}`, 30, 60)) {
    return apiError('Too many verification submissions. Try again in a minute.', 429, 'rate_limit_error')
  }

  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('multipart/form-data')) {
    return apiError('Send this request as multipart/form-data.')
  }
  const form = await request.formData()

  const carrierName = String(form.get('carrier_name') || '').trim()
  const brokerName = String(form.get('broker_name') || '').trim()
  if (!carrierName) return apiError('`carrier_name` is required.')
  if (!brokerName) return apiError('`broker_name` is required.')

  // Every document slot takes an attached file OR an https link (downloaded
  // server-side; links dodge the platform's ~4.5MB request-body cap). NOT a
  // type predicate: a plain (non-URL) string must stay a string downstream
  // (insurance_standards falls through to its free-text branch).
  const isDoc = (v: FormDataEntryValue | null): boolean =>
    (v instanceof File && v.size > 0) || (typeof v === 'string' && isDocumentUrl(v))

  const coi = form.get('coi')
  if (!coi || !isDoc(coi)) return apiError('`coi` document is required (attach the file or send an https link to it).')

  const files: { file: File | string; kind: string }[] = [{ file: coi, kind: 'coi' }]

  // Any other relevant documents (rate confirmations, endorsements, ...).
  // Stored under the legacy 'rcs' document kind.
  const extras = form.getAll('additional_documents').filter(isDoc).slice(0, 5)
  for (const f of extras) files.push({ file: f, kind: 'rcs' })

  const svc = createServiceClient()

  // Standards come from a saved template (template_id or template_name +
  // template_variables), a file, or a plain text string — one is required.
  const templateIdIn = String(form.get('template_id') || '').trim()
  const templateName = String(form.get('template_name') || '').trim()
  const standards = form.get('insurance_standards')
  let requirements: unknown = null
  let templateId: string | undefined
  if (templateIdIn || templateName) {
    let q = svc.from('requirement_templates').select(TEMPLATE_SELECT).eq('org_id', auth.orgId)
    q = templateIdIn ? q.eq('id', templateIdIn) : q.eq('name', templateName)
    const { data: t } = await q.maybeSingle<RequirementTemplate>()
    if (!t) return apiError('No template with that id or name exists for your account. List templates with GET /v1/templates.')
    let values: Record<string, string> = {}
    const rawVars = String(form.get('template_variables') || '').trim()
    if (rawVars) {
      try {
        values = JSON.parse(rawVars)
      } catch {
        return apiError('`template_variables` must be a JSON object, e.g. {"asset_sale_price": "$85,000"}.')
      }
    }
    values = { carrier_name: carrierName, ...values }
    try {
      const resolved = resolveTemplate(t, values)
      requirements = [{ type: 'text', value: resolved.text }, { type: 'template', ...resolved.provenance }]
      templateId = t.id
    } catch (e) {
      return apiError(e instanceof Error ? e.message : 'Could not apply the template.')
    }
  } else if (standards && isDoc(standards)) {
    files.push({ file: standards, kind: 'requirements' })
  } else if (typeof standards === 'string' && standards.trim()) {
    requirements = [{ type: 'text', value: standards.trim() }]
  } else {
    return apiError('`insurance_standards` is required (text or file), or send `template_id` / `template_name` for a saved standard.')
  }

  const autoCall = String(form.get('auto_call') || '') === 'true'
  const verificationFiles: VerificationFile[] = []
  for (const { file, kind } of files) {
    const maxBytes = UPLOAD_MAX_BYTES[kind as keyof typeof UPLOAD_MAX_BYTES]
    let bytes: ArrayBuffer, name: string, declaredMime: string
    if (typeof file === 'string') {
      const remote = await fetchRemoteDocument(file, maxBytes)
      if (!remote.ok) return apiError(`\`${kind}\` link: ${remote.error}`)
      ;({ bytes, name, contentType: declaredMime } = remote)
    } else {
      bytes = await file.arrayBuffer()
      name = file.name
      declaredMime = file.type
    }
    const check = validateUpload(bytes, declaredMime, UPLOAD_ALLOW[kind as keyof typeof UPLOAD_ALLOW], maxBytes)
    if (!check.ok) return apiError(`\`${kind}\` ${typeof file === 'string' ? 'link' : 'file'} "${name}": ${check.error}`)
    verificationFiles.push({
      bytes,
      name,
      mimeType: check.mimeType,
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
      templateId,
      autoCall,
      files: verificationFiles,
      // Sandbox auto-completes with canned data; nobody needs to review it.
      notify: auth.mode !== 'sandbox',
    }))
  } catch (e) {
    // Internal detail stays in the logs; API clients get a generic failure.
    console.error('POST /v1/verifications failed:', e)
    return apiError('Could not create the verification. Please retry.', 500, 'api_error')
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
  const { data, error } = await svc.from('verifications')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  // An outage must not read as "you have no verifications".
  if (error) {
    return Response.json(
      { error: { type: 'api_error', message: 'Something went wrong. Retry the request.' } },
      { status: 500 },
    )
  }

  return Response.json({ object: 'list', data: (data ?? []).map(v => serializeVerification(v)) })
}
