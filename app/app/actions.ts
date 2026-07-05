'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import { uploadDocument } from '@/lib/storage'
import { generateApiKey, type KeyMode } from '@/lib/apikeys'

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

  // Insurance standards are required: a document or pasted text.
  const reqFile = formData.get('requirements_file') as File | null
  if ((!reqFile || reqFile.size === 0) && !requirementsText) {
    return { error: 'Insurance standards are required. Upload a file or enter them manually.' }
  }

  const supabase = await createClient()
  const { data: v, error } = await supabase
    .from('verifications')
    .insert({
      org_id: profile.org_id,
      created_by: profile.id,
      carrier_name: carrier,
      source: 'web',
      status: 'pending',
      requirements: requirementsText ? { text: requirementsText } : null,
    })
    .select('id')
    .single()
  if (error || !v) return { error: error?.message || 'Could not create verification.' }

  const files: [File | null, 'coi' | 'rcs' | 'requirements'][] = [
    [coi, 'coi'],
    [formData.get('rcs_file') as File | null, 'rcs'],
    [reqFile, 'requirements'],
  ]
  for (const [file, kind] of files) {
    if (!file || file.size === 0) continue
    const path = `${profile.org_id}/${v.id}/${kind}-${file.name}`
    await uploadDocument(path, await file.arrayBuffer(), file.type || 'application/octet-stream')
    const { error: derr } = await supabase.from('documents').insert({
      org_id: profile.org_id,
      verification_id: v.id,
      kind,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      uploaded_by: profile.id,
    })
    if (derr) return { error: derr.message }
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
