'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getProfile } from '@/lib/auth-helpers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { Requirement } from '@/lib/types'
import { normalizeRequirementRows } from '@/lib/templates'
import { rateLimitAllows } from '@/lib/rate-limit'

export interface TemplateState { ok?: boolean; error?: string }

/** Create or update one of the org's insurance-standards templates. */
export async function saveTemplate(_prev: TemplateState, formData: FormData): Promise<TemplateState> {
  const profile = await getProfile()
  if (!profile?.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const id = String(formData.get('id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'Give the template a name.' }

  let rawRows: Requirement[]
  try {
    rawRows = JSON.parse(String(formData.get('rows') || '[]'))
  } catch {
    return { error: 'Could not read the requirement rows.' }
  }
  const { requirements, variables, error: rowsError } = normalizeRequirementRows(rawRows)
  if (rowsError) return { error: rowsError }
  if (requirements.length === 0) return { error: 'Add at least one requirement row.' }
  const details = String(formData.get('details') || '').trim() || null

  const isDefault = String(formData.get('is_default') || '') === 'true'
  const supabase = await createClient()

  // The partial unique index allows one default per org: clear the old one
  // first, and abort if that fails (otherwise the insert below hits the index
  // and surfaces a raw duplicate-key error).
  if (isDefault) {
    const { error: clearErr } = await supabase.from('requirement_templates')
      .update({ is_default: false })
      .eq('org_id', profile.org_id)
      .eq('is_default', true)
    if (clearErr) return { error: 'Could not save. Nothing was changed. Please retry.' }
  }

  const row = {
    org_id: profile.org_id,
    name,
    requirements,
    variables,
    details,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  }
  const { error } = id
    ? await supabase.from('requirement_templates').update(row).eq('id', id).eq('org_id', profile.org_id)
    : await supabase.from('requirement_templates').insert({ ...row, created_by: profile.id })
  if (error) return { error: error.message }

  revalidatePath('/app/settings')
  revalidatePath('/app/new')
  return { ok: true }
}

export async function deleteTemplate(templateId: string): Promise<{ error?: string } | void> {
  const profile = await getProfile()
  if (!profile?.org_id) return
  const supabase = await createClient()
  const { error } = await supabase.from('requirement_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', profile.org_id)
  if (error) return { error: 'Could not delete. Please retry.' }
  revalidatePath('/app/settings')
  revalidatePath('/app/new')
}

export interface InviteState { ok?: boolean; error?: string }

/**
 * Invite a teammate into the caller's own org. Uses the service client for the
 * auth admin API, but the org is always the inviter's — never user-supplied.
 */
export async function inviteTeammate(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const profile = await getProfile()
  if (!profile?.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' }

  // Invites send real email; keep one org from spamming addresses.
  if (!await rateLimitAllows(`invite:${profile.org_id}`, 10, 3600)) {
    return { error: "You've invited too many people in the last hour. Contact a Fordra admin for help." }
  }

  const hdrs = await headers()
  const origin = hdrs.get('origin') || `https://${hdrs.get('host') || 'app.fordra.com'}`

  const svc = createServiceClient()
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/link`,
  })
  if (error) return { error: error.message }

  // handle_new_user() created the profile row; link it to the inviter's org.
  // Only fill an EMPTY org_id: a member must never be able to pull an existing
  // user out of another org by "inviting" their email.
  if (data.user) {
    const { error: perr } = await svc.from('profiles')
      .update({ org_id: profile.org_id })
      .eq('id', data.user.id)
      .is('org_id', null)
    if (perr) return { error: 'Invited, but could not add them to your organization. Contact a Fordra admin for help.' }
  }

  revalidatePath('/app/settings')
  return { ok: true }
}
