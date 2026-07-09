'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAdmin, isAdminEmail } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { emitEvent } from '@/lib/webhooks'
import { runExtractionPipeline } from '@/lib/extraction'

/**
 * Run OCR/extraction on a verification's documents and store the parsed analysis.
 * The pipeline body lives in lib/extraction.ts, shared with the dedicated
 * /api/admin/run-extraction route (raised maxDuration on Vercel — Claude vision
 * regularly exceeds the default limit; prefer the route in production).
 */
export async function runExtraction(verificationId: string) {
  await requireAdmin()
  await runExtractionPipeline(verificationId)
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

export interface CreateOrgState { ok?: boolean; error?: string }

/** Create a new customer org. Members are then added via Invite User. */
export async function createOrg(_prev: CreateOrgState, formData: FormData): Promise<CreateOrgState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'Enter an org name.' }

  const { data: existing } = await supabase.from('orgs').select('id').ilike('name', name).maybeSingle()
  if (existing) return { error: 'An org with that name already exists.' }

  const { error } = await supabase.from('orgs').insert({ name })
  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { ok: true }
}

export interface InviteUserState { ok?: boolean; error?: string; signinLink?: string }

/**
 * Invite a new user by email and assign them to an org in one step.
 * Also mints a direct sign-in link (generateLink token_hash, accepted by
 * /auth/callback) so the admin can hand it over when email delivery is flaky.
 */
export async function inviteUser(_prev: InviteUserState, formData: FormData): Promise<InviteUserState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const email = String(formData.get('email') || '').trim().toLowerCase()
  const orgId = String(formData.get('org_id') || '')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' }
  if (!orgId) return { error: 'Pick an org.' }

  const hdrs = await headers()
  const origin = hdrs.get('origin') || `https://${hdrs.get('host') || 'app.fordra.com'}`

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
  })
  if (error) return { error: error.message }

  // handle_new_user() created the profile row; link it to the chosen org.
  if (data.user) {
    const { error: perr } = await supabase.from('profiles').update({ org_id: orgId }).eq('id', data.user.id)
    if (perr) return { error: `Invited, but could not link the account: ${perr.message}` }
  }

  // Fallback link in case the invite email does not arrive.
  let signinLink: string | undefined
  const { data: linkData } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  const props = linkData?.properties
  if (props?.hashed_token) {
    signinLink = `${origin}/auth/callback?token_hash=${props.hashed_token}&type=magiclink`
  }

  revalidatePath('/admin/users')
  return { ok: true, signinLink }
}

export interface DeleteUserState { ok?: boolean; error?: string }

/**
 * Delete a user account (auth user + profile). Admin accounts (ADMIN_EMAIL
 * allowlist) can never be deleted from the UI. The org's history survives:
 * the user's verifications get created_by nulled instead of cascading away.
 */
export async function deleteUser(_prev: DeleteUserState, formData: FormData): Promise<DeleteUserState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const profileId = String(formData.get('profile_id') || '')
  if (!profileId) return { error: 'Pick a user.' }

  const { data: profile } = await supabase
    .from('profiles').select('id, email').eq('id', profileId).maybeSingle()
  if (!profile) return { error: 'That user no longer exists.' }
  if (isAdminEmail(profile.email)) return { error: 'Admin accounts cannot be deleted from here.' }

  await supabase.from('verifications').update({ created_by: null }).eq('created_by', profileId)
  const { error: perr } = await supabase.from('profiles').delete().eq('id', profileId)
  if (perr) return { error: perr.message }
  const { error: aerr } = await supabase.auth.admin.deleteUser(profileId)
  if (aerr) return { error: `Profile removed, but the sign-in account could not be deleted: ${aerr.message}` }

  revalidatePath('/admin/users')
  return { ok: true }
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
