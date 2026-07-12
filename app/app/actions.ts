'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey, type KeyMode } from '@/lib/apikeys'
import { createVerification, type VerificationFile, type DocumentKind } from '@/lib/verifications'
import { normalizeRequirementRows, resolveTemplate, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'
import type { Requirement } from '@/lib/types'
import {
  validateUploadHead, UPLOAD_ALLOW, UPLOAD_MAX_BYTES,
  OTHER_DOCS_TOTAL_BYTES, OTHER_DOCS_MAX_COUNT,
} from '@/lib/upload-validation'
import { createSignedUpload, statStoredObject, removeDocuments } from '@/lib/storage'

export interface SubmitState { error?: string }

export interface UploadMeta { name: string; size: number; kind: DocumentKind }
export interface PreparedUploads { error?: string; uploads?: { path: string; token: string }[] }

/**
 * Mint signed upload URLs so the browser can PUT documents straight into the
 * private bucket. Vercel hard-caps function request bodies at ~4.5MB, so file
 * bytes can never ride the submit action itself; this restores the real
 * 20MB/50MB limits. Objects land under <org>/incoming/ and are verified
 * server-side (magic bytes + true size) by submitVerification before any
 * verification references them.
 */
export async function prepareUploads(files: UploadMeta[]): Promise<PreparedUploads> {
  const profile = await getProfile()
  if (!profile) return { error: 'Please sign in again.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const counts: Record<DocumentKind, number> = { coi: 0, rcs: 0, requirements: 0 }
  let otherTotal = 0
  for (const f of files) {
    if (!(f.kind in counts)) return { error: 'Unknown document slot.' }
    counts[f.kind]++
    if (f.kind === 'rcs') otherTotal += f.size
    if (f.size > UPLOAD_MAX_BYTES[f.kind]) {
      return { error: `${f.name} is larger than ${Math.floor(UPLOAD_MAX_BYTES[f.kind] / (1024 * 1024))} MB. Upload a smaller file.` }
    }
  }
  if (counts.coi > 1 || counts.requirements > 1 || counts.rcs > OTHER_DOCS_MAX_COUNT) {
    return { error: 'Too many documents. One COI, one standards document, and up to 5 other documents.' }
  }
  if (otherTotal > OTHER_DOCS_TOTAL_BYTES) {
    return { error: 'The other documents exceed 50 MB together. Remove a file or upload smaller ones.' }
  }

  try {
    const batch = randomUUID()
    // The index keeps two same-named files from colliding on one key.
    const uploads = await Promise.all(files.map((f, i) => {
      const safeName = f.name.replace(/[^\w.\- ]+/g, '_')
      return createSignedUpload(`${profile.org_id}/incoming/${batch}/${i}-${f.kind}-${safeName}`)
    }))
    return { uploads }
  } catch (e) {
    console.error('prepareUploads failed', e)
    return { error: 'Could not prepare the upload. Please retry.' }
  }
}

/**
 * Customer manual-upload submission → creates a pending verification + documents.
 * Returns an error string for the client form to show; the client navigates on success.
 */
export async function submitVerification(formData: FormData): Promise<SubmitState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Please sign in again.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const carrier = String(formData.get('carrier_name') || '').trim()
  if (!carrier) return { error: 'Carrier name is required.' }
  const requirementsText = String(formData.get('requirements_text') || '').trim()

  // Documents arrive via direct-to-storage uploads (prepareUploads above);
  // the form sends only their storage paths. Never trust them blindly: each
  // path must sit under THIS org's incoming/ prefix and pass byte sniffing.
  let uploaded: { path: string; name: string; kind: DocumentKind }[]
  try {
    const parsed = JSON.parse(String(formData.get('uploaded_files') || '[]'))
    if (!Array.isArray(parsed)) throw new Error('bad shape')
    uploaded = parsed
  } catch {
    return { error: 'Could not read the uploaded documents. Please retry the submission.' }
  }
  if (!uploaded.some(u => u.kind === 'coi')) return { error: 'A COI document is required.' }

  const supabase = await createClient()

  // Saved standard: resolve the org's template (RLS scopes the lookup) with
  // per-deal variable values into the same { text } shape manual entry produces.
  // The form may send edited rows (template_rows) — deal-specific tweaks that
  // override the stored rows for this submission without changing the template.
  const templateId = String(formData.get('template_id') || '').trim()
  let requirements: unknown = requirementsText ? { text: requirementsText } : null
  if (templateId) {
    const { data: t, error: terr } = await supabase
      .from('requirement_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', templateId)
      .single<RequirementTemplate>()
    // A transient read failure is not "not found": tell the user to retry.
    if (terr && terr.code !== 'PGRST116') return { error: 'Could not load the saved standard. Please retry.' }
    if (!t) return { error: 'That saved standard could not be found.' }

    let rows = t.requirements
    let variables = t.variables ?? []
    const rawRows = String(formData.get('template_rows') || '').trim()
    if (rawRows) {
      try {
        const parsed = JSON.parse(rawRows) as Requirement[]
        if (!Array.isArray(parsed)) throw new Error('bad shape')
        // Re-derive variables from the edited rows: a renamed or added Variable
        // row changes which per-deal values apply to this submission.
        const normalized = normalizeRequirementRows(parsed)
        if (normalized.error) return { error: normalized.error }
        if (normalized.requirements.length === 0) return { error: 'Add at least one requirement row.' }
        rows = normalized.requirements
        variables = normalized.variables
      } catch {
        return { error: 'Could not read the adjusted requirement rows.' }
      }
    }

    // Per-deal override of the standard's free-text details; absent field
    // (non-web callers) falls back to the stored value.
    const rawDetails = formData.get('template_details')
    const details = rawDetails === null ? t.details : (String(rawDetails).trim() || null)

    // {carrier_name} is auto-filled from the carrier field, never a form input.
    const values: Record<string, string> = { carrier_name: carrier }
    for (const v of variables) values[v.key] = String(formData.get(`template_var_${v.key}`) || '')
    try {
      const resolved = resolveTemplate({ ...t, requirements: rows, variables, details }, values)
      requirements = { text: resolved.text, ...resolved.provenance }
    } catch (e) {
      console.error('new verification: could not apply template', e)
      return { error: 'Could not apply the saved template. Please contact a Fordra admin for help.' }
    }
  }

  // Insurance standards are required: a saved standard, a document, or pasted text.
  const hasReqDoc = uploaded.some(u => u.kind === 'requirements')
  if (!templateId && !hasReqDoc && !requirementsText) {
    return { error: 'Insurance standards are required. Pick a saved template, write an explanation, or upload a file.' }
  }

  // Verify every referenced object: right org prefix, finished uploading,
  // right magic bytes, within its slot's size cap, other-docs total ≤ 50MB.
  const allPaths = uploaded.map(u => u.path)
  const abort = async (error: string) => { await removeDocuments(allPaths); return { error } }
  const prefix = `${profile.org_id}/incoming/`
  const counts: Record<DocumentKind, number> = { coi: 0, rcs: 0, requirements: 0 }
  let otherTotal = 0
  const files: VerificationFile[] = []
  const seenPaths = new Set<string>()
  for (const u of uploaded) {
    if (!u.path?.startsWith(prefix) || seenPaths.has(u.path) || !(u.kind in counts)) {
      return abort('Could not read the uploaded documents. Please retry the submission.')
    }
    seenPaths.add(u.path)
    counts[u.kind]++
    const stat = await statStoredObject(u.path)
    if (!stat) return abort(`"${u.name}" did not finish uploading. Please retry the submission.`)
    const check = validateUploadHead(stat.head, stat.size, '', UPLOAD_ALLOW[u.kind], UPLOAD_MAX_BYTES[u.kind])
    if (!check.ok) return abort(`${u.name}: ${check.error}`)
    if (u.kind === 'rcs') otherTotal += stat.size
    files.push({ existingStoragePath: u.path, name: u.name, mimeType: check.mimeType, kind: u.kind, sizeBytes: stat.size })
  }
  if (counts.coi > 1 || counts.requirements > 1 || counts.rcs > OTHER_DOCS_MAX_COUNT) {
    return abort('Too many documents. One COI, one standards document, and up to 5 other documents.')
  }
  if (otherTotal > OTHER_DOCS_TOTAL_BYTES) {
    return abort('The other documents exceed 50 MB together. Remove a file or upload smaller ones.')
  }

  try {
    await createVerification(supabase, {
      orgId: profile.org_id,
      carrierName: carrier,
      source: 'web',
      requirements,
      templateId: templateId || undefined,
      createdBy: profile.id,
      files,
      // Session client: column-level grants forbid select('*') on verifications.
      // display_id is SELECT-granted and rides into the email alert.
      select: 'id, display_id',
    })
  } catch (e) {
    console.error('new verification: create failed', e)
    // createVerification's compensation removes only objects IT uploaded;
    // direct-to-storage objects are ours to clean.
    await removeDocuments(allPaths)
    return { error: 'Could not create verification. Please contact a Fordra admin for help.' }
  }

  revalidatePath('/app')
  return {}
}

export interface CreateKeyState {
  secret?: string
  prefix?: string
  error?: string
}

/** Create an API key for the customer's org. Returns the secret ONCE. */
export async function createApiKey(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not signed in.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const mode = (String(formData.get('mode') || 'sandbox') === 'live' ? 'live' : 'sandbox') as KeyMode
  const { secret, prefix, hash } = generateApiKey(mode)

  const supabase = await createClient()
  const { error } = await supabase.from('api_keys').insert({
    org_id: profile.org_id,
    mode,
    key_hash: hash,
    key_prefix: prefix,
    name: `${mode} key`,
  })
  if (error) {
    console.error('createApiKey failed', error)
    return { error: 'Could not create the key. Please retry.' }
  }

  revalidatePath('/app/docs')
  return { secret, prefix }
}

/** Revoke one of the org's API keys. Revoked keys stop authenticating immediately. */
export async function revokeApiKey(keyId: string) {
  const profile = await getProfile()
  if (!profile?.org_id) return

  const supabase = await createClient()
  // RLS scopes the update to the caller's org; the org check is belt and braces.
  const { error } = await supabase.from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('org_id', profile.org_id)
  // A silently failed revoke of a live secret is a security lie; fail loudly
  // (the error boundary renders, and the key still shows Active on reload).
  if (error) throw new Error(`Could not revoke the key: ${error.message}`)
  revalidatePath('/app/docs')
}
