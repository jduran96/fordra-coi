'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey, type KeyMode } from '@/lib/apikeys'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { resolveTemplate, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'

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
  const templateId = String(formData.get('template_id') || '').trim()
  let requirements: unknown = requirementsText ? { text: requirementsText } : null
  if (templateId) {
    const { data: t } = await supabase
      .from('requirement_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', templateId)
      .single<RequirementTemplate>()
    if (!t) return { error: 'That saved standard could not be found.' }
    // {carrier_name} is auto-filled from the carrier field, never a form input.
    const values: Record<string, string> = { carrier_name: carrier }
    for (const v of t.variables ?? []) values[v.key] = String(formData.get(`template_var_${v.key}`) || '')
    try {
      const resolved = resolveTemplate(t, values)
      requirements = { text: resolved.text, ...resolved.provenance }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not apply the saved standard.' }
    }
  }

  // Insurance standards are required: a saved standard, a document, or pasted text.
  const reqFile = formData.get('requirements_file') as File | null
  if (!templateId && (!reqFile || reqFile.size === 0) && !requirementsText) {
    return { error: 'Insurance standards are required. Pick a saved standard, upload a file, or enter them manually.' }
  }

  const fileInputs: [File | null, 'coi' | 'rcs' | 'requirements'][] = [
    [coi, 'coi'],
    [formData.get('rcs_file') as File | null, 'rcs'],
    [reqFile, 'requirements'],
  ]
  const files: VerificationFile[] = []
  for (const [file, kind] of fileInputs) {
    if (!file || file.size === 0) continue
    files.push({
      bytes: await file.arrayBuffer(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      kind,
    })
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
    return { error: e instanceof Error ? e.message : 'Could not create verification.' }
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
  if (error) return { error: error.message }

  revalidatePath('/app/docs')
  return { secret, prefix }
}

/** Revoke one of the org's API keys. Revoked keys stop authenticating immediately. */
export async function revokeApiKey(keyId: string) {
  const profile = await getProfile()
  if (!profile?.org_id) return

  const supabase = await createClient()
  // RLS scopes the update to the caller's org; the org check is belt and braces.
  await supabase.from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('org_id', profile.org_id)
  revalidatePath('/app/docs')
}
