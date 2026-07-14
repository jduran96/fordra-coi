'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAdmin, isAdminEmail } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { DOCUMENTS_BUCKET } from '@/lib/storage'
import { emitEvent } from '@/lib/webhooks'
import { serializeVerification } from '@/lib/api-auth'
import { runExtractionPipeline } from '@/lib/extraction'
import { verifyInsurerContact } from '@/lib/claude'
import type { COIExtracted } from '@/lib/types'

/**
 * Run OCR/extraction on a verification's documents and store the parsed analysis.
 * The pipeline body lives in lib/extraction.ts, shared with the dedicated
 * /api/admin/run-extraction route (raised maxDuration on Vercel — Claude vision
 * regularly exceeds the default limit; prefer the route in production).
 */
export async function runExtraction(verificationId: string, formData?: FormData) {
  await requireAdmin()
  // "Keep requirement checks & summary" checkbox: checked re-extracts the
  // documents without touching an existing assessment; unchecked regenerates
  // the checks and drops the manual summary so the fresh copy shows.
  const assessment = formData?.get('keep_assessment') === 'on' ? 'keep' : 'overwrite'
  try {
    await runExtractionPipeline(verificationId, { assessment })
  } catch (e) {
    // Record why extraction died (error_detail was previously never written
    // by anything), then let the error surface to the admin.
    const detail = e instanceof Error ? e.message : String(e)
    await createServiceClient().from('verifications')
      .update({ error_detail: `extraction failed: ${detail}`.slice(0, 500) })
      .eq('id', verificationId)
      .then(() => {}, () => {})
    throw e
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Web-search verification of the agent/producer contact printed on the COI.
 * Deliberately its own button, NOT part of runExtraction: the check costs
 * real money per run (up to 5 web searches + their result tokens, roughly
 * $0.10-0.20), so the admin spends it only when they actually want it.
 * Requires a completed extraction (it reads coi_extracted).
 */
export async function runContactCheck(verificationId: string) {
  await requireAdmin()
  const supabase = createServiceClient()
  const { data: v, error } = await supabase.from('verifications')
    .select('coi_extracted')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v?.coi_extracted) {
    throw new Error('Run extraction first: the contact check reads the extracted COI.')
  }
  // verifyInsurerContact never throws; null means the COI names no agency or
  // the search failed — store it so the card shows the honest empty state.
  const check = await verifyInsurerContact(v.coi_extracted as COIExtracted)
  const { error: werr } = await supabase.from('verifications')
    .update({ contact_check: check })
    .eq('id', verificationId)
  if (werr) throw new Error(`Could not save the contact check: ${werr.message}`)
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Save the insurer contact + append a timestamped call note.
 * call_notes is an append-only jsonb array: [{ at, text, contact }]. The
 * append happens in the admin_append_call_note RPC (migration 0016) as one
 * atomic UPDATE: no read-modify-write, so a bad read or a concurrent save can
 * never wipe or drop notes. Failures return { error } so the dialog keeps the
 * typed note instead of clearing it.
 */
/**
 * Closed = published or rejected. Closed cases are read-only everywhere (the
 * assessment form AND call notes) until the admin explicitly reopens via
 * Edit Status; the UI hides the controls, this is the server-side guard.
 */
async function caseClosed(supabase: ReturnType<typeof createServiceClient>, verificationId: string): Promise<boolean> {
  const { data } = await supabase.from('verifications')
    .select('published_at, case_status')
    .eq('id', verificationId)
    .maybeSingle()
  return !!data && (!!data.published_at || data.case_status === 'rejected')
}

export async function saveCallNote(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }

  const insurance_contact = {
    name: String(formData.get('contact_name') || '').trim(),
    phone: String(formData.get('contact_phone') || '').trim(),
    email: String(formData.get('contact_email') || '').trim(),
  }
  // The form clears after each save; an all-blank contact means "keep the
  // previously saved one", not "erase it".
  const hasContact = Object.values(insurance_contact).some(Boolean)
  if (hasContact) {
    const { error } = await supabase.from('verifications')
      .update({ insurance_contact })
      .eq('id', verificationId)
    if (error) {
      console.error('saveCallNote: contact update failed', error)
      return { error: 'Could not save. Your note is still here. Please retry.' }
    }
  }

  const text = String(formData.get('note') || '').trim()
  if (text) {
    // The RPC snapshots the contact into the note (form contact if given,
    // otherwise the saved insurer contact) so each entry records who was
    // spoken to even if the contact fields change later.
    const { error } = await supabase.rpc('admin_append_call_note', {
      vid: verificationId,
      note_text: text,
      contact: hasContact ? insurance_contact : null,
    })
    if (error) {
      console.error('saveCallNote: append failed', error)
      return { error: 'Could not save. Your note is still here. Please retry.' }
    }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/** Remove one saved call note, identified by its timestamp. Admin only. */
export async function deleteCallNote(verificationId: string, noteAt: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }
  const { error } = await supabase.rpc('admin_delete_call_note', {
    vid: verificationId,
    note_at: noteAt,
  })
  if (error) {
    console.error('deleteCallNote failed', error)
    return { error: 'Could not delete this note. Please retry.' }
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
 *
 * State machine (customers only ever see the last thing that was PUBLISHED):
 *  - draft:   working copy; clears published_at, so editing a published report
 *             takes it out of the customer's view until it is republished
 *  - publish: releases exactly this assessment (sets published_at + completed)
 *  - reject:  closes the request without a report; clears published_at and the
 *             customer sees the rejected notice
 */
export async function saveAssessment(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()

  // Edit Status on a closed (published or rejected) case: reopen it into the
  // review queue WITHOUT touching final_report. The closed form's fields are
  // disabled and absent from the submission, so parsing them here would wipe
  // the saved verdicts.
  if (String(formData.get('intent') || '') === 'reopen') {
    const { error } = await supabase.from('verifications')
      .update({ case_status: 'report_ready', status: 'pending', published_at: null })
      .eq('id', verificationId)
    if (error) {
      console.error('saveAssessment: reopen failed', error)
      return { error: 'Could not save. Nothing was changed. Please retry.' }
    }
    revalidatePath('/admin')
    revalidatePath(`/admin/${verificationId}`)
    return
  }

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
  const intent = String(formData.get('intent') || '')
  const publish = intent === 'publish'
  // Reject: the request is closed without a customer-facing report. The draft
  // still saves, and a later Save draft or Publish un-rejects it.
  const reject = intent === 'reject'

  const update: Record<string, unknown> = {
    final_report: { ...report, narrative_summary },
    case_status: reject ? 'rejected' : 'report_ready',
  }
  if (publish) {
    update.status = 'completed'
    update.published_at = new Date().toISOString()
  } else {
    // Draft and reject both take the report out of the customer's view: what
    // customers see must always be exactly the last published assessment.
    update.status = 'pending'
    update.published_at = null
  }

  const { data: v, error } = await supabase.from('verifications')
    .update(update)
    .eq('id', verificationId)
    .select('*')
    .single()
  if (error || !v) {
    console.error('saveAssessment: update failed', error)
    return { error: 'Could not save. Nothing was changed. Please retry.' }
  }

  if (publish) {
    // The webhook payload must be exactly what GET /v1/verifications/:id
    // returns (and what the sandbox delivers) — integrators build against one
    // shape.
    const { data: docs } = await supabase.from('documents')
      .select('kind, file_name')
      .eq('verification_id', verificationId)
    await emitEvent(v.org_id as string, 'verification.updated', serializeVerification(v, docs ?? []))
    revalidatePath('/admin')
    redirect('/admin')
  }
  if (reject) {
    revalidatePath('/admin')
    redirect('/admin')
  }
  revalidatePath(`/admin/${verificationId}`)
}

const INTERNAL_FLAG_VALUES = ['called_jd', 'called_em', 'voicemail_jd', 'voicemail_em']

/**
 * Set (or clear) the internal admin organization flag on a verification —
 * who called / left a voicemail. Admin-only bookkeeping: plain column, no
 * grants to `authenticated`, not in my_verifications, so it never reaches
 * the customer app or the /v1 API.
 */
export async function setInternalFlag(verificationId: string, flag: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const value = INTERNAL_FLAG_VALUES.includes(flag) ? flag : null
  const supabase = createServiceClient()
  const { error } = await supabase.from('verifications').update({ internal_flag: value }).eq('id', verificationId)
  if (error) {
    console.error('setInternalFlag failed', error)
    return { error: 'Could not save. Please retry.' }
  }
  revalidatePath('/admin')
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

export interface OrgActionState { ok?: boolean; error?: string }

/** Rename an org. Same duplicate guard as createOrg. */
export async function renameOrg(_prev: OrgActionState, formData: FormData): Promise<OrgActionState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const orgId = String(formData.get('org_id') || '')
  const name = String(formData.get('name') || '').trim()
  if (!orgId) return { error: 'Pick an org.' }
  if (!name) return { error: 'Enter an org name.' }

  const { data: existing } = await supabase
    .from('orgs').select('id').ilike('name', name).neq('id', orgId).maybeSingle()
  if (existing) return { error: 'An org with that name already exists.' }

  const { error } = await supabase.from('orgs').update({ name }).eq('id', orgId)
  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { ok: true }
}

/**
 * Delete an org and everything in it: member users (profile + sign-in
 * account; admins are only unassigned, never deleted), verifications with
 * their documents rows and storage objects, Slack installations and intake
 * sessions (no FK cascade). api_keys, webhooks, events, and templates
 * cascade in the schema.
 */
export async function deleteOrg(_prev: OrgActionState, formData: FormData): Promise<OrgActionState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const orgId = String(formData.get('org_id') || '')
  if (!orgId) return { error: 'Pick an org.' }

  // Members: delete customer accounts outright; admin accounts survive
  // with org_id cleared (same rule as deleteUser).
  const { data: members, error: merr } = await supabase
    .from('profiles').select('id, email').eq('org_id', orgId)
  if (merr) return { error: merr.message }
  for (const m of members ?? []) {
    if (isAdminEmail(m.email)) {
      const { error } = await supabase.from('profiles').update({ org_id: null }).eq('id', m.id)
      if (error) return { error: error.message }
      continue
    }
    const { error: perr } = await supabase.from('profiles').delete().eq('id', m.id)
    if (perr) return { error: perr.message }
    const { error: aerr } = await supabase.auth.admin.deleteUser(m.id)
    if (aerr) {
      console.error('deleteOrg: auth user delete failed', m.email, aerr)
      return { error: `Removed ${m.email}'s profile, but their sign-in account could not be deleted. Try again.` }
    }
  }

  // Verifications: storage objects first (Storage API, not SQL), then rows.
  const { data: verifs, error: verr } = await supabase
    .from('verifications').select('id').eq('org_id', orgId)
  if (verr) return { error: verr.message }
  const vIds = (verifs ?? []).map(v => v.id)
  if (vIds.length) {
    const { data: docs } = await supabase
      .from('documents').select('storage_path').in('verification_id', vIds)
    const paths = (docs ?? []).map(d => d.storage_path).filter(Boolean)
    if (paths.length) {
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths)
      if (error) {
        console.error('deleteOrg: storage remove failed', error)
        return { error: "Could not delete the org's stored documents. Try again." }
      }
    }
    const { error: derr } = await supabase.from('documents').delete().in('verification_id', vIds)
    if (derr) return { error: derr.message }
    const { error: vderr } = await supabase.from('verifications').delete().in('id', vIds)
    if (vderr) return { error: vderr.message }
  }

  const { error: sserr } = await supabase.from('slack_intake_sessions').delete().eq('org_id', orgId)
  if (sserr) return { error: sserr.message }
  const { error: serr } = await supabase.from('slack_installations').delete().eq('org_id', orgId)
  if (serr) return { error: serr.message }
  const { error } = await supabase.from('orgs').delete().eq('id', orgId)
  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { ok: true }
}

export interface InviteUserState { ok?: boolean; error?: string; signinLink?: string; existing?: boolean }

/**
 * Invite a new user by email and assign them to an org in one step.
 * Also mints a direct sign-in link (generateLink token_hash, accepted by
 * /auth/callback) so the admin can hand it over when email delivery is flaky.
 * Re-inviting an existing user (e.g. their original link expired) is not an
 * error: it re-links the org and returns a fresh sign-in link.
 */
export async function inviteUser(_prev: InviteUserState, formData: FormData): Promise<InviteUserState> {
  await requireAdmin()
  const supabase = createServiceClient()

  const email = String(formData.get('email') || '').trim().toLowerCase()
  const orgIdRaw = String(formData.get('org_id') || '')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' }
  if (!orgIdRaw) return { error: 'Pick an org.' }
  // 'none' invites the user without an org (they see the "contact a Fordra
  // admin" screen until assigned from Edit User).
  const orgId = orgIdRaw === 'none' ? null : orgIdRaw

  const hdrs = await headers()
  const origin = hdrs.get('origin') || `https://${hdrs.get('host') || 'app.fordra.com'}`

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/link`,
  })

  // Already registered (their first invite link expired, or they were added
  // another way): not an error — re-link the org and mint a fresh link below.
  const existing = !!error && (error.code === 'email_exists' || /already.*registered/i.test(error.message))
  if (error && !existing) return { error: error.message }

  if (existing) {
    const { data: prof, error: perr } = await supabase
      .from('profiles').select('id').eq('email', email).maybeSingle()
    if (perr) return { error: perr.message }
    if (!prof) return { error: 'This email has a sign-in account but no profile. Contact support.' }
    const { error: uerr } = await supabase.from('profiles').update({ org_id: orgId }).eq('id', prof.id)
    if (uerr) {
      console.error('inviteUser: org link failed', uerr)
      return { error: 'Could not link the account to the org. Try again.' }
    }
  } else if (data.user) {
    // handle_new_user() created the profile row; link it to the chosen org.
    const { error: perr } = await supabase.from('profiles').update({ org_id: orgId }).eq('id', data.user.id)
    if (perr) {
      console.error('inviteUser: org link failed', perr)
      return { error: 'Invited, but could not link the account to the org. Fix it from Edit User.' }
    }
  }

  // Fallback link in case the invite email does not arrive; for an existing
  // user this fresh link IS the point of re-inviting. Points at the /auth/link
  // interstitial, NOT the callback: the token is single-use and link-preview
  // crawlers would consume a direct callback URL before the human clicks.
  let signinLink: string | undefined
  const { data: linkData } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  const props = linkData?.properties
  if (props?.hashed_token) {
    signinLink = `${origin}/auth/link?token_hash=${props.hashed_token}&type=magiclink`
  }
  if (existing && !signinLink) return { error: 'Could not mint a new sign-in link. Try again.' }

  revalidatePath('/admin/users')
  return { ok: true, signinLink, existing }
}

/**
 * Mint a fresh one-time sign-in link for an existing user (e.g. their invite
 * expired). Same token_hash flow the invite fallback uses; accepted by
 * /auth/callback from any browser.
 */
export async function mintSigninLink(email: string): Promise<{ signinLink?: string; error?: string }> {
  await requireAdmin()
  const supabase = createServiceClient()

  const hdrs = await headers()
  const origin = hdrs.get('origin') || `https://${hdrs.get('host') || 'app.fordra.com'}`

  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) return { error: error.message }
  const hashed = data?.properties?.hashed_token
  if (!hashed) return { error: 'Supabase returned no link token. Try again.' }
  // /auth/link interstitial, not the callback — see inviteUser.
  return { signinLink: `${origin}/auth/link?token_hash=${hashed}&type=magiclink` }
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
  if (aerr) {
    console.error('deleteUser: auth user delete failed', aerr)
    return { error: 'Profile removed, but the sign-in account could not be deleted. Try again.' }
  }

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

  // 'none' unassigns the user (back to the "contact a Fordra admin" screen).
  const { error } = await supabase.from('profiles')
    .update({ org_id: orgId === 'none' ? null : orgId })
    .eq('id', profileId)
  if (error) return { error: error.message }
  revalidatePath('/admin/users')
  return { ok: true }
}
