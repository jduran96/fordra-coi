'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { notifyVerificationResult } from '@/lib/notify'
import { notifySlackReportReady } from '@/Slack/notify'
import { requireAdmin, isAdminEmail } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { DOCUMENTS_BUCKET } from '@/lib/storage'
import { emitEvent } from '@/lib/webhooks'
import { serializeVerification } from '@/lib/api-auth'
import { runExtractionPipeline } from '@/lib/extraction'
import { verifyLoggedContact } from '@/lib/claude'
import { activityKind, adminInitials } from '@/lib/admin-activity'
import { sanitizeSummaryHtml, summaryPlainText } from '@/lib/sanitize-note'
import { contactValue, deriveLegitimacy, noteCheckFromRegistry, normalizePhone, normalizeEmail } from '@/lib/contact-notes'
import type { COIExtracted, ContactCheckEntry, ContactNote, ExternalConfirmation, NoteContactCheck, OnlineListingStatus, WebsiteStatus } from '@/lib/types'

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
 * Web-verify a phone/email against the issuing producer's public listings
 * and APPEND the result to the verification-level check history
 * (contact_checks). This is the ONLY place a contact web search runs —
 * deliberately its own button, never automatic: each run costs real money
 * (Haiku + up to 4 searches + 2 page fetches; typically ~$0.05-0.08, capped
 * around $0.20 — the entry's stored usage records the real cost). Contact
 * logs inherit their tags by value-matching against this history, spending
 * nothing. Blank fields are never searched.
 */
const parseWebsiteStatus = (raw: FormDataEntryValue | null): WebsiteStatus =>
  raw === 'aligns' || raw === 'differs' ? raw : 'not_found'
const parseExternal = (raw: FormDataEntryValue | null): ExternalConfirmation =>
  raw === 'confirmed' ? raw : 'not_confirmed'

export async function runOnlineContactCheck(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }
  const { data: v, error } = await supabase.from('verifications')
    .select('coi_extracted')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('runOnlineContactCheck: read failed', error)
    return { error: 'Could not load this verification. Please retry.' }
  }
  const coi = (v.coi_extracted ?? null) as COIExtracted | null
  const producer = (coi?.producer ?? '').trim()
  const insurer = (coi?.insurance_company ?? '').trim()
  if (!producer && !insurer) {
    return { error: 'Run extraction first: the check searches the producer named on the COI.' }
  }
  const phone = contactValue(String(formData.get('phone') || ''))
  const email = contactValue(String(formData.get('email') || ''))
  if (!phone && !email) {
    return { error: 'Enter a phone or email to verify.' }
  }
  const check = await verifyLoggedContact({ producer, insurer, phone, email })
  if (!check) return { error: 'The web check came back empty. Please retry.' }
  const entry: ContactCheckEntry = {
    ...check,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  }
  const { error: werr } = await supabase.rpc('admin_append_contact_check', {
    vid: verificationId,
    entry,
  })
  if (werr) {
    console.error('runOnlineContactCheck: write failed', werr)
    return { error: 'Could not save the check. Please retry.' }
  }
  await retroTagNotes(supabase, verificationId)
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Save the admin's edits to one check-history entry: flip the phone/email
 * statuses or reword the customer-facing blurb. The edit then propagates to
 * every matching contact log (except logs whose own check was hand-edited).
 */
export async function saveContactCheckEdit(verificationId: string, entryAt: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }
  const { data: v, error } = await supabase.from('verifications')
    .select('contact_checks')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('saveContactCheckEdit: read failed', error)
    return { error: 'Could not save. Please retry.' }
  }
  const entries = (Array.isArray(v.contact_checks) ? v.contact_checks : []) as ContactCheckEntry[]
  const entry = entries.find(e => e.checked_at === entryAt)
  if (!entry) return { error: 'This check no longer exists.' }

  const parseStatus = (raw: FormDataEntryValue | null): OnlineListingStatus =>
    raw === 'verified' || raw === 'differs' ? raw : 'not_found'
  const next: ContactCheckEntry = {
    ...entry,
    // A status is only ever set for a field the check covered: the form
    // renders a select per checked field only.
    ...(formData.has('phone_status') ? { phone_status: parseStatus(formData.get('phone_status')) } : {}),
    ...(formData.has('email_status') ? { email_status: parseStatus(formData.get('email_status')) } : {}),
    ...(formData.has('website_status') ? { website_status: parseWebsiteStatus(formData.get('website_status')) } : {}),
    ...(formData.has('external_confirmation') ? { external_confirmation: parseExternal(formData.get('external_confirmation')) } : {}),
    blurb: String(formData.get('blurb') || '').trim(),
    edited_at: new Date().toISOString(),
  }
  // The verdict is always derived, never edited directly: an admin flipping
  // any status re-computes it here so history and note snapshots agree.
  const legitimacy = deriveLegitimacy(next)
  if (legitimacy) next.legitimacy = legitimacy
  const { error: werr } = await supabase.rpc('admin_set_contact_check', {
    vid: verificationId,
    entry_at: entryAt,
    entry_data: next,
  })
  if (werr) {
    console.error('saveContactCheckEdit: write failed', werr)
    return { error: 'Could not save. Please retry.' }
  }
  await retroTagNotes(supabase, verificationId)
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Re-derive every contact log's check snapshot from the current check
 * history (after a run or an edit), so logs written BEFORE a check still get
 * their tags. Rules:
 *  - a note whose own check was hand-edited (contact_check.edited_at) is
 *    never touched: edited_at marks human-curated customer copy;
 *  - a field the history does not match keeps the note's existing status
 *    (legacy per-log check results survive);
 *  - no match at all leaves the note alone (never destroys old data).
 * Writes go per-note through the atomic admin_set_note_check RPC — never
 * read-modify-write the whole call_notes array. Failures log and continue:
 * each note is independently correct.
 */
async function retroTagNotes(supabase: ReturnType<typeof createServiceClient>, verificationId: string): Promise<void> {
  const { data: v, error } = await supabase.from('verifications')
    .select('call_notes, contact_checks')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('retroTagNotes: read failed', error)
    return
  }
  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
  const entries = (Array.isArray(v.contact_checks) ? v.contact_checks : []) as ContactCheckEntry[]
  for (const note of notes) {
    if (note.contact_check?.edited_at) continue
    const phone = contactValue(note.contact?.phone)
    const email = contactValue(note.contact?.email)
    if (!phone && !email) continue
    const candidate = noteCheckFromRegistry(entries, phone, email)
    if (!candidate) continue
    const existing = note.contact_check
    const merged: NoteContactCheck = {
      ...candidate,
      // Carry a status the history did not cover from the note's old check.
      ...(!candidate.phone_status && existing?.phone_status ? { phone_status: existing.phone_status } : {}),
      ...(!candidate.email_status && existing?.email_status ? { email_status: existing.email_status } : {}),
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) continue
    const { error: werr } = await supabase.rpc('admin_set_note_check', {
      vid: verificationId,
      note_at: note.at,
      check_data: merged,
    })
    if (werr) console.error('retroTagNotes: write failed for note', note.at, werr)
  }
}

/**
 * Save the admin's edits to one log's contact verification: flip the
 * phone/email statuses or reword the customer-facing blurb. Only available
 * once a check has run on that log.
 */
export async function saveNoteCheck(verificationId: string, noteAt: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }
  const { data: v, error } = await supabase.from('verifications')
    .select('call_notes')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('saveNoteCheck: read failed', error)
    return { error: 'Could not save. Please retry.' }
  }
  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
  const note = notes.find(n => n.at === noteAt)
  if (!note?.contact_check) return { error: 'Run the online check first.' }

  const parseStatus = (raw: FormDataEntryValue | null): OnlineListingStatus =>
    raw === 'verified' || raw === 'differs' ? raw : 'not_found'
  const next: NoteContactCheck = {
    ...note.contact_check,
    // A status is only ever set for a field the check covered: the form
    // renders a select per checked field only.
    ...(formData.has('phone_status') ? { phone_status: parseStatus(formData.get('phone_status')) } : {}),
    ...(formData.has('email_status') ? { email_status: parseStatus(formData.get('email_status')) } : {}),
    ...(formData.has('website_status') ? { website_status: parseWebsiteStatus(formData.get('website_status')) } : {}),
    ...(formData.has('external_confirmation') ? { external_confirmation: parseExternal(formData.get('external_confirmation')) } : {}),
    blurb: String(formData.get('blurb') || '').trim(),
    edited_at: new Date().toISOString(),
  }
  // Same rule as the history edit: the verdict is derived, never typed in.
  const legitimacy = deriveLegitimacy(next)
  if (legitimacy) next.legitimacy = legitimacy
  const { error: werr } = await supabase.rpc('admin_set_note_check', {
    vid: verificationId,
    note_at: noteAt,
    check_data: next,
  })
  if (werr) {
    console.error('saveNoteCheck: write failed', werr)
    return { error: 'Could not save. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Save the insurer contact + append a timestamped contact note.
 * call_notes is an append-only jsonb array of
 * { at, contact_method?, summary_html?, summary_text?, transcript?, contact }
 * (legacy entries carry { at, text, contact }). The append happens in the
 * admin_append_contact_note RPC (migration 0022) as one atomic UPDATE: no
 * read-modify-write, so a bad read or a concurrent save can never wipe or
 * drop notes. Failures return { error } so the dialog keeps the typed note
 * instead of clearing it.
 */
/**
 * Closed = published or failed. Closed cases are read-only everywhere (the
 * assessment form AND call notes) until the admin explicitly reopens via
 * Edit Status; the UI hides the controls, this is the server-side guard.
 */
async function caseClosed(supabase: ReturnType<typeof createServiceClient>, verificationId: string): Promise<boolean> {
  const { data } = await supabase.from('verifications')
    .select('published_at, case_status')
    .eq('id', verificationId)
    .maybeSingle()
  return !!data && (!!data.published_at || data.case_status === 'failed')
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

  const contact_method = String(formData.get('contact_method') || '').trim()
  // The editor only emits b/i/u paragraphs, but the HTML crosses a form
  // boundary: re-sanitize before storing, and derive the plain-text copy the
  // PDF renders.
  const summary_html = sanitizeSummaryHtml(String(formData.get('summary_html') || ''))
  const summary_text = summaryPlainText(summary_html)
  const transcript = String(formData.get('transcript') || '').trim()

  if (summary_text || transcript) {
    // The note inherits its verification tags from the online check history
    // by value match (normalized, so copy-pasted formatting differences
    // still hit) — no web search at log time. The snapshot must be derived
    // from the SAME contact the RPC will store: the form contact when given,
    // otherwise the saved insurer contact it falls back to.
    const { data: row } = await supabase.from('verifications')
      .select('insurance_contact, contact_checks')
      .eq('id', verificationId)
      .maybeSingle()
    const effective = hasContact
      ? insurance_contact
      : ((row?.insurance_contact ?? {}) as typeof insurance_contact)
    const check_data = noteCheckFromRegistry(
      (Array.isArray(row?.contact_checks) ? row.contact_checks : []) as ContactCheckEntry[],
      contactValue(effective.phone),
      contactValue(effective.email),
    )
    // The RPC snapshots the contact into the note (form contact if given,
    // otherwise the saved insurer contact) so each entry records who was
    // reached even if the contact fields change later.
    const { error } = await supabase.rpc('admin_append_contact_note', {
      vid: verificationId,
      contact_method,
      summary_html,
      summary_text,
      transcript,
      contact: hasContact ? insurance_contact : null,
      check_data,
    })
    if (error) {
      console.error('saveCallNote: append failed', error)
      return { error: 'Could not save. Your note is still here. Please retry.' }
    }
  } else if (!hasContact) {
    // Nothing to append and no contact to update: tell the admin instead of
    // silently closing the dialog with nothing saved.
    return { error: 'Add a summary or a transcript before saving.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Edit one saved contact note in place, identified by its `at` timestamp
 * (which never changes: it is the note's identity and its displayed date).
 * Contact fields are editable; a changed phone/email re-derives the log's
 * verification tags from the check registry by value match, while an
 * unchanged contact keeps the existing snapshot untouched (it may carry
 * manual status/blurb edits made via saveNoteCheck). Deliberately does NOT
 * touch the verification-level insurance_contact: editing history must never
 * silently change the current insurer contact.
 */
export async function updateCallNote(verificationId: string, noteAt: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) {
    return { error: 'This case is closed. Click Edit Status in the Assessment section to reopen it first.' }
  }
  const { data: row, error } = await supabase.from('verifications')
    .select('call_notes, contact_checks')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !row) {
    console.error('updateCallNote: read failed', error)
    return { error: 'Could not save. Your edits are still here. Please retry.' }
  }
  const notes = (Array.isArray(row.call_notes) ? row.call_notes : []) as ContactNote[]
  const note = notes.find(n => n.at === noteAt)
  if (!note) return { error: 'This note no longer exists. Close the dialog and refresh the page.' }

  const contact = {
    name: String(formData.get('contact_name') || '').trim(),
    phone: String(formData.get('contact_phone') || '').trim(),
    email: String(formData.get('contact_email') || '').trim(),
  }
  // Same contract as saveCallNote: all-blank contact means "keep what was
  // saved", never "erase who was reached".
  const hasContact = Object.values(contact).some(Boolean)
  const nextContact = hasContact ? contact : (note.contact ?? {})

  const contact_method = String(formData.get('contact_method') || '').trim()
  const summary_html = sanitizeSummaryHtml(String(formData.get('summary_html') || ''))
  const summary_text = summaryPlainText(summary_html)
  const transcript = String(formData.get('transcript') || '').trim()
  if (!summary_text && !transcript) {
    return { error: 'Add a summary or a transcript before saving.' }
  }

  const phoneChanged = normalizePhone(nextContact.phone) !== normalizePhone(note.contact?.phone)
  const emailChanged = normalizeEmail(nextContact.email) !== normalizeEmail(note.contact?.email)
  const check = (phoneChanged || emailChanged)
    ? noteCheckFromRegistry(
        (Array.isArray(row.contact_checks) ? row.contact_checks : []) as ContactCheckEntry[],
        contactValue(nextContact.phone),
        contactValue(nextContact.email),
      )
    : note.contact_check ?? null

  // Whole-object replacement. Legacy `text` is deliberately dropped: the edit
  // dialog prefills the summary editor from it, so its content survives as
  // summary_html/summary_text.
  const next: ContactNote = {
    at: note.at,
    ...(contact_method ? { contact_method } : {}),
    ...(summary_html ? { summary_html, summary_text } : {}),
    ...(transcript ? { transcript } : {}),
    contact: nextContact,
    ...(check ? { contact_check: check } : {}),
    edited_at: new Date().toISOString(),
  }
  const { error: werr } = await supabase.rpc('admin_update_call_note', {
    vid: verificationId,
    note_at: noteAt,
    note_data: next,
  })
  if (werr) {
    console.error('updateCallNote: write failed', werr)
    return { error: 'Could not save. Your edits are still here. Please retry.' }
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
  insurer_confirmation?: 'call' | 'email'
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
 *  - fail:    closes the request without a report (e.g. the insurer could not
 *             be reached); clears published_at and the customer sees the
 *             Failed status with the admin's reason
 */
export async function saveAssessment(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()

  // Edit Status on a closed (published or failed) case: reopen it into the
  // review queue WITHOUT touching final_report. The closed form's fields are
  // disabled and absent from the submission, so parsing them here would wipe
  // the saved verdicts. Reopening clears the failure reason so a stale one
  // can never resurface on a later fail.
  if (String(formData.get('intent') || '') === 'reopen') {
    const { error } = await supabase.from('verifications')
      .update({ case_status: 'report_ready', status: 'pending', published_at: null, failure_reason: null })
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
    // Omitted entirely when not confirmed, so legacy readers and the
    // automated-report path never see the key.
    const conf = String(formData.get(`req_${i}_insurer_confirmation`) || '')
    report[status].push({
      requirement, status, evidence,
      ...(conf === 'call' || conf === 'email' ? { insurer_confirmation: conf } : {}),
    })
  }

  const narrative_summary = String(formData.get('narrative_summary') || '').trim()
  const intent = String(formData.get('intent') || '')
  const publish = intent === 'publish'
  // Fail: the request is closed without a customer-facing report; the reason
  // is required and shown to the customer. The draft still saves, and a later
  // Save draft or Publish un-fails it.
  const fail = intent === 'fail'
  const failureReason = String(formData.get('failure_reason') || '').trim()
  if (fail && !failureReason) {
    return { error: 'Write the reason before marking this verification failed.' }
  }

  const update: Record<string, unknown> = {
    final_report: { ...report, narrative_summary },
    case_status: fail ? 'failed' : 'report_ready',
    // Save/publish clear any reason so it can never outlive the failed state.
    failure_reason: fail ? failureReason : null,
  }
  if (publish) {
    update.status = 'completed'
    update.published_at = new Date().toISOString()
  } else {
    // Draft and fail both take the report out of the customer's view: what
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

  // Notify checkbox in the publish/fail confirm dialogs: the message to the
  // submitter fires ONLY on this explicit per-case opt-in (human in the loop,
  // so test publishes on other orgs never spam anyone). Web rows email the
  // created_by portal user; Slack rows DM the captured slack_context channel.
  // API rows (and legacy Slack rows without context) have no one to notify.
  if ((publish || fail) && formData.get('notify_user') === 'on') {
    const outcomeNote = publish ? 'report published' : 'could not be completed'
    // Every send goes on the activity log so there's a record of who
    // notified whom. Log failure must not block the publish itself.
    const logNotify = async (note: string) => {
      const { error: logErr } = await supabase.rpc('admin_append_activity', {
        vid: verificationId,
        kind: 'note',
        actor: adminInitials(admin.email ?? ''),
        note,
      })
      if (logErr) console.error('saveAssessment: notify audit log failed', logErr)
    }
    if (v.created_by) {
      const { data: uploader } = await supabase.from('profiles')
        .select('email').eq('id', v.created_by).maybeSingle()
      const toEmail = uploader?.email
      if (toEmail) {
        after(() => notifyVerificationResult({
          verificationId,
          displayId: (v as { display_id?: string }).display_id,
          carrierName: String(v.carrier_name ?? 'your carrier'),
          outcome: publish ? 'completed' : 'failed',
          toEmail,
        }))
        await logNotify(`Notified ${toEmail}: ${outcomeNote}`)
      }
    } else if (v.source === 'slack' && v.slack_context) {
      const slackContext = v.slack_context as { team_id: string; channel_id: string; user_id: string }
      after(() => notifySlackReportReady({
        verificationId,
        displayId: (v as { display_id?: string }).display_id,
        carrierName: String(v.carrier_name ?? 'your carrier'),
        outcome: publish ? 'completed' : 'failed',
        slackContext,
      }))
      await logNotify(`Notified Slack submitter: ${outcomeNote}`)
    }
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
  if (fail) {
    revalidatePath('/admin')
    redirect('/admin')
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Append one entry to the admin activity log: what happened (called /
 * voicemail / emailed / note), stamped server-side with the time and the
 * admin's initials from the session. Admin-only bookkeeping (column has no
 * grants to `authenticated`); the append is an atomic RPC so concurrent
 * admins can never drop each other's entries.
 */
export async function logAdminActivity(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const kind = activityKind(String(formData.get('kind') || ''))
  if (!kind) return { error: 'Pick what happened.' }
  const note = String(formData.get('note') || '').trim().slice(0, 500)
  const supabase = createServiceClient()
  const { error } = await supabase.rpc('admin_append_activity', {
    vid: verificationId,
    kind,
    actor: adminInitials(admin.email ?? ''),
    note,
  })
  if (error) {
    console.error('logAdminActivity failed', error)
    return { error: 'Could not save. Please retry.' }
  }
  // The legacy single-value internal_flag has no clear control anymore (the
  // old picker's "none" option was it); logging real activity supersedes and
  // clears it so a stale/wrong legacy pill can't linger in the queue.
  await supabase.from('verifications').update({ internal_flag: null }).eq('id', verificationId)
  revalidatePath('/admin')
  revalidatePath(`/admin/${verificationId}`)
}

/** Remove one activity entry, identified by its timestamp. Admin only. */
export async function deleteAdminActivity(verificationId: string, entryAt: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const { error } = await supabase.rpc('admin_delete_activity', {
    vid: verificationId,
    entry_at: entryAt,
  })
  if (error) {
    console.error('deleteAdminActivity failed', error)
    return { error: 'Could not delete. Please retry.' }
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
