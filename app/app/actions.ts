'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey, type KeyMode } from '@/lib/apikeys'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { normalizeRequirementRows, resolveTemplate, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'
import type { Requirement } from '@/lib/types'
import { validateUpload, UPLOAD_ALLOW } from '@/lib/upload-validation'

export interface SubmitState { error?: string }

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

  const coi = formData.get('coi_file') as File | null
  if (!coi || coi.size === 0) return { error: 'A COI document is required.' }

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
  const reqFile = formData.get('requirements_file') as File | null
  if (!templateId && (!reqFile || reqFile.size === 0) && !requirementsText) {
    return { error: 'Insurance standards are required. Pick a saved template, write an explanation, or upload a file.' }
  }

  const fileInputs: [File | null, 'coi' | 'rcs' | 'requirements'][] = [
    [coi, 'coi'],
    [formData.get('rcs_file') as File | null, 'rcs'],
    [reqFile, 'requirements'],
  ]
  const files: VerificationFile[] = []
  for (const [file, kind] of fileInputs) {
    if (!file || file.size === 0) continue
    const bytes = await file.arrayBuffer()
    const check = validateUpload(bytes, file.type, UPLOAD_ALLOW[kind])
    if (!check.ok) return { error: `${file.name}: ${check.error}` }
    files.push({ bytes, name: file.name, mimeType: check.mimeType, kind })
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
      select: 'id',
    })
  } catch (e) {
    console.error('new verification: create failed', e)
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
