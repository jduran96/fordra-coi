'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getProfile } from '@/lib/auth-helpers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { Requirement } from '@/lib/types'
import type { TemplateVariable } from '@/lib/templates'
import { templateTokens } from '@/lib/templates'

export interface TemplateState { ok?: boolean; error?: string }

function humanize(key: string): string {
  const label = key.replaceAll('_', ' ').trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Variables are derived from the {tokens} used in the rows, one input each.
 * {carrier_name} is special: it is filled from the verification's carrier field
 * automatically, never asked for.
 */
function deriveVariables(requirements: Requirement[]): TemplateVariable[] {
  return templateTokens({ requirements }).filter(key => key !== 'carrier_name').map(key => ({
    key,
    label: humanize(key),
    type: /price|amount|limit|value/.test(key) ? 'currency' : 'text',
    required: true,
  }))
}

/** Create or update one of the org's insurance-standards templates. */
export async function saveTemplate(_prev: TemplateState, formData: FormData): Promise<TemplateState> {
  const profile = await getProfile()
  if (!profile?.org_id) return { error: 'Your account is not linked to an organization yet.' }

  const id = String(formData.get('id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'Give the template a name.' }

  let requirements: Requirement[]
  try {
    requirements = JSON.parse(String(formData.get('rows') || '[]'))
  } catch {
    return { error: 'Could not read the requirement rows.' }
  }
  requirements = requirements
    .map(r => ({
      coverage_type: (r.coverage_type ?? '').trim(),
      minimum_limit: (r.minimum_limit ?? '').trim(),
      notes: (r.notes ?? '').trim() || null,
    }))
    .filter(r => r.coverage_type)
  if (requirements.length === 0) return { error: 'Add at least one requirement row.' }

  const isDefault = String(formData.get('is_default') || '') === 'true'
  const supabase = await createClient()

  // The partial unique index allows one default per org: clear the old one first.
  if (isDefault) {
    await supabase.from('requirement_templates')
      .update({ is_default: false })
      .eq('org_id', profile.org_id)
      .eq('is_default', true)
  }

  const row = {
    org_id: profile.org_id,
    name,
    requirements,
    variables: deriveVariables(requirements),
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

export async function deleteTemplate(templateId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile?.org_id) return
  const supabase = await createClient()
  await supabase.from('requirement_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', profile.org_id)
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

  const hdrs = await headers()
  const origin = hdrs.get('origin') || `https://${hdrs.get('host') || 'app.fordra.com'}`

  const svc = createServiceClient()
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
  })
  if (error) return { error: error.message }

  // handle_new_user() created the profile row; link it to the inviter's org.
  if (data.user) {
    const { error: perr } = await svc.from('profiles')
      .update({ org_id: profile.org_id })
      .eq('id', data.user.id)
    if (perr) return { error: `Invited, but could not link the account: ${perr.message}` }
  }

  revalidatePath('/app/settings')
  return { ok: true }
}
