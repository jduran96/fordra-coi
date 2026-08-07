'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { adminInitials } from '@/lib/admin-activity'
import { downloadDocument } from '@/lib/storage'
import { connectorByProvider } from '@/lib/email-connectors'
import { providerFor, type EmailAccountRow } from '@/lib/email-provider'
import { syncEmailThread, syncVerificationThreads } from '@/lib/email-sync'
import { applyTokensToHtml, formatThreadText, ORG_NAME_TOKEN, parseEmailList, POLICY_NUMBERS_TOKEN, type EmailMessage, type EmailThread } from '@/lib/email-shared'
import { EMAIL_RE } from '@/lib/email-draft-config'
import { applyQuestionTokens, deriveLastNValues, QUESTION_TOKEN_RE, templateVariableValues } from '@/lib/question-config'
import { collectVins } from '@/lib/call-config'
import { sanitizeSummaryHtml, summaryPlainText } from '@/lib/sanitize-note'
import { contactValue, noteCheckFromRegistry } from '@/lib/contact-notes'
import { recordEvent } from '@/lib/webhooks'
import type { ContactCheckEntry, ContactNote, Requirement } from '@/lib/types'

/**
 * Email outreach actions. Every mutation begins with requireAdmin():
 * drafting, sending, replying, and logging verification emails are
 * admin-only, full stop. approveAndSendEmail is the ONLY code path that hands
 * a message to the provider, and it re-validates server-side — the draft
 * card's validation is a courtesy copy, never the gate.
 */

/** Same closed-case rule as the main admin actions: published or failed = read-only. */
async function caseClosed(supabase: ReturnType<typeof createServiceClient>, verificationId: string): Promise<boolean> {
  const { data } = await supabase.from('verifications')
    .select('published_at, case_status')
    .eq('id', verificationId)
    .maybeSingle()
  return !!data && (!!data.published_at || data.case_status === 'failed')
}

const CLOSED_ERROR = 'This case is closed. Click Edit Status in the Assessment section to reopen it first.'

async function logActivity(
  supabase: ReturnType<typeof createServiceClient>,
  verificationId: string,
  adminEmail: string,
  note: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_append_activity', {
    vid: verificationId,
    kind: 'note',
    actor: adminInitials(adminEmail),
    note,
  })
  if (error) console.error('email activity log failed', error)
}

interface DraftFields {
  to: string[]
  cc: string[]
  subject: string
  body: string
  attachmentIds: string[]
}

function parseDraftFields(formData: FormData): DraftFields {
  const list = (name: string) => String(formData.get(name) ?? '')
    .split(',').map(e => e.trim()).filter(Boolean)
  let attachmentIds: string[] = []
  try {
    const raw = JSON.parse(String(formData.get('attachments_json') || '[]'))
    if (Array.isArray(raw)) attachmentIds = raw.filter((x): x is string => typeof x === 'string')
  } catch { /* treated as none */ }
  return {
    to: list('to'),
    cc: list('cc'),
    subject: String(formData.get('subject') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
    attachmentIds,
  }
}

/** The verification's docs matching the picked ids; null when any id is foreign. */
async function attachableDocs(
  supabase: ReturnType<typeof createServiceClient>,
  verificationId: string,
  ids: string[],
): Promise<{ id: string; file_name: string; mime_type: string | null; storage_path: string }[] | null> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('documents')
    .select('id, file_name, mime_type, storage_path')
    .eq('verification_id', verificationId)
    .in('id', ids)
  if (error || !data || data.length !== ids.length) return null
  return data
}

async function loadThread(
  supabase: ReturnType<typeof createServiceClient>,
  verificationId: string,
  threadId: string,
): Promise<EmailThread | null> {
  const { data } = await supabase.from('email_threads')
    .select('*')
    .eq('id', threadId)
    .eq('verification_id', verificationId)
    .maybeSingle()
  return (data as EmailThread | null) ?? null
}

async function loadMessages(
  supabase: ReturnType<typeof createServiceClient>,
  threadId: string,
): Promise<EmailMessage[]> {
  const { data } = await supabase.from('email_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
  return (data ?? []) as EmailMessage[]
}

/** Save the draft card as the verification's draft (one draft row per verification). */
export async function saveEmailDraft(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const fields = parseDraftFields(formData)
  // The body is rich text: re-sanitize at the form boundary, same contract as
  // the contact-note summary.
  fields.body = sanitizeSummaryHtml(fields.body)
  const docs = await attachableDocs(supabase, verificationId, fields.attachmentIds)
  if (!docs) return { error: 'Could not match the picked attachments to this verification. Please retry.' }

  const { data: existing } = await supabase.from('email_threads')
    .select('id')
    .eq('verification_id', verificationId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = {
    verification_id: verificationId,
    created_by: adminInitials(admin.email ?? ''),
    status: 'draft',
    subject: fields.subject,
    to_emails: fields.to,
    cc_emails: fields.cc,
    body_text: fields.body,
    attachments: docs.map(d => ({ document_id: d.id, file_name: d.file_name })),
    updated_at: new Date().toISOString(),
  }
  const { error } = existing
    ? await supabase.from('email_threads').update(row).eq('id', existing.id)
    : await supabase.from('email_threads').insert(row)
  if (error) {
    console.error('saveEmailDraft failed', error)
    return { error: 'Could not save the draft. Please retry.' }
  }
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * The send gate: validate the exact draft, freeze it with the approver's
 * identity, then hand it to the provider. A send failure keeps the frozen
 * payload and the error on the row — the attempt is part of the audit trail.
 */
export async function approveAndSendEmail(verificationId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const fields = parseDraftFields(formData)

  const { data: v } = await supabase.from('verifications')
    .select('org_id, display_id, requirements, requirements_normalized, coi_extracted, orgs(name)')
    .eq('id', verificationId)
    .maybeSingle()
  if (!v) return { error: 'Could not load this verification. Please retry.' }

  // Resolve per-deal {tokens} at send time too, so tokens typed by hand on
  // the deal page (or left over from the template) fill from the deal's own
  // variables; only genuinely unknown tokens block. Same map as the page's
  // prefill: template variables + org name + COI policy numbers, plus derived
  // {..._lastN} tokens (plain style: emails are read, not spoken).
  const coverages = ((v.coi_extracted ?? null) as { coverages?: { policy_number?: string }[] } | null)?.coverages ?? []
  const baseValues: Record<string, string> = {
    ...templateVariableValues(v.requirements),
    [ORG_NAME_TOKEN]: (v.orgs as { name?: string } | null)?.name ?? '',
    [POLICY_NUMBERS_TOKEN]: [...new Set(coverages.map(c => (c.policy_number ?? '').trim()).filter(Boolean))].join(', '),
  }
  const emailReqs = (Array.isArray(v.requirements_normalized) ? v.requirements_normalized : []) as Requirement[]
  const tokenValues: Record<string, string> = {
    ...baseValues,
    ...deriveLastNValues([fields.subject, fields.body], baseValues, { vins: collectVins(emailReqs) }),
  }
  const subject = applyQuestionTokens(fields.subject, tokenValues)
  const bodyHtml = sanitizeSummaryHtml(applyTokensToHtml(fields.body, tokenValues))
  const bodyText = summaryPlainText(bodyHtml)

  // Server-side validation: hard blocks refuse the send outright.
  if (!fields.to.length) return { error: 'Add at least one recipient.' }
  const badTo = [...fields.to, ...fields.cc].find(e => !EMAIL_RE.test(e))
  if (badTo) return { error: `"${badTo}" is not a valid email address.` }
  if (!subject) return { error: 'Write a subject line.' }
  if (!bodyText) return { error: 'Write the email body.' }
  const tokenMatch = `${subject}\n${bodyText}`.match(QUESTION_TOKEN_RE)
  if (tokenMatch) return { error: `Fill in ${tokenMatch[0]} before sending.` }

  const { data: accountRow } = await supabase.from('email_accounts')
    .select('*')
    .eq('org_id', v.org_id as string)
    .maybeSingle()
  if (!accountRow) return { error: 'No mailbox is connected for this org yet. Connect one in Settings, Emails tab.' }
  const account = accountRow as EmailAccountRow
  const maxAttachmentBytes = connectorByProvider(account.provider)?.maxAttachmentBytes ?? 15 * 1024 * 1024

  const docs = await attachableDocs(supabase, verificationId, fields.attachmentIds)
  if (!docs) return { error: 'Could not match the picked attachments to this verification. Please retry.' }

  // Download attachments before freezing: a missing file must fail the send
  // before anything is recorded as approved.
  const attachmentFiles: { filename: string; mimeType: string; bytes: Uint8Array }[] = []
  let totalBytes = 0
  for (const d of docs) {
    let file
    try {
      file = await downloadDocument(d.storage_path)
    } catch (e) {
      console.error('approveAndSendEmail: attachment download failed', e)
      return { error: `Could not read the attachment "${d.file_name}". Nothing was sent.` }
    }
    totalBytes += file.bytes.byteLength
    if (totalBytes > maxAttachmentBytes) {
      return { error: `The attachments are too large to email (${Math.floor(maxAttachmentBytes / 1024 / 1024)} MB limit). Uncheck one and retry.` }
    }
    attachmentFiles.push({
      filename: d.file_name,
      mimeType: d.mime_type || file.contentType || 'application/octet-stream',
      bytes: new Uint8Array(file.bytes),
    })
  }

  // Freeze the approved send FIRST: the audit record exists even if the
  // provider request dies. Reuse the draft row when there is one.
  const { data: draft } = await supabase.from('email_threads')
    .select('id')
    .eq('verification_id', verificationId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const payload = {
    from: account.email_address,
    to: fields.to,
    cc: fields.cc,
    subject,
    body_html: bodyHtml,
    body_text: bodyText,
    attachments: docs.map(d => ({ document_id: d.id, file_name: d.file_name })),
  }
  const approvedRow = {
    verification_id: verificationId,
    account_id: account.id,
    created_by: adminInitials(admin.email ?? ''),
    status: 'approved',
    subject,
    to_emails: fields.to,
    cc_emails: fields.cc,
    body_text: bodyHtml,
    attachments: payload.attachments,
    payload,
    approved_by: admin.email ?? '',
    approved_at: new Date().toISOString(),
    provider: account.provider,
    updated_at: new Date().toISOString(),
  }
  const { data: saved, error: saveErr } = draft
    ? await supabase.from('email_threads').update(approvedRow).eq('id', draft.id).select('id').single()
    : await supabase.from('email_threads').insert(approvedRow).select('id').single()
  if (saveErr || !saved) {
    console.error('approveAndSendEmail: approval write failed', saveErr)
    return { error: 'Could not record the approval. Nothing was sent. Please retry.' }
  }

  try {
    const result = await providerFor(account).send(supabase, account, {
      to: fields.to,
      cc: fields.cc,
      subject,
      bodyText: bodyText,
      bodyHtml: bodyHtml,
      attachments: attachmentFiles,
    })
    const now = new Date().toISOString()
    const { error } = await supabase.from('email_threads').update({
      status: 'sent',
      provider_thread_id: result.providerThreadId,
      provider_message_id: result.providerMessageId,
      last_message_at: now,
      last_direction: 'outbound',
      message_count: 1,
      updated_at: now,
    }).eq('id', saved.id)
    if (error) console.error('approveAndSendEmail: sent update failed', error)
    // Mirror the outbound message locally right away; the next sync dedupes
    // on provider_message_id, so this never double-counts.
    const { error: msgErr } = await supabase.from('email_messages').upsert({
      thread_id: saved.id,
      provider_message_id: result.providerMessageId,
      message_id_header: result.messageIdHeader,
      direction: 'outbound',
      from_email: account.email_address.toLowerCase(),
      from_name: account.display_name,
      to_emails: fields.to,
      cc_emails: fields.cc,
      subject,
      body_text: bodyText,
      attachments: attachmentFiles.map(a => ({ filename: a.filename, mime_type: a.mimeType, size: a.bytes.byteLength })),
      sent_at: now,
    }, { onConflict: 'thread_id,provider_message_id', ignoreDuplicates: true })
    if (msgErr) console.error('approveAndSendEmail: message mirror failed', msgErr)
    await logActivity(supabase, verificationId, admin.email ?? '',
      `Verification email sent to ${fields.to.join(', ')}${v.display_id ? ` (${v.display_id})` : ''}`)
    revalidatePath(`/admin/${verificationId}`)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    await supabase.from('email_threads')
      .update({ status: 'failed', error: detail.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', saved.id)
    revalidatePath(`/admin/${verificationId}`)
    return { error: `The email could not be sent: ${detail}` }
  }
}

/**
 * Reply inside an existing thread from the connected mailbox. Syncs first so
 * the reply threads under the true latest message, and re-syncs after so the
 * sent reply shows immediately.
 */
export async function sendEmailReply(verificationId: string, threadId: string, formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { error: 'Write the reply first.' }

  const thread = await loadThread(supabase, verificationId, threadId)
  if (!thread) return { error: 'Could not load this thread. Please retry.' }
  if (thread.status !== 'sent' || !thread.provider_thread_id) return { error: 'This thread has not been sent yet.' }
  if (!thread.account_id) return { error: 'The mailbox this thread was sent from is no longer connected.' }

  const { data: accountRow } = await supabase.from('email_accounts')
    .select('*').eq('id', thread.account_id).maybeSingle()
  if (!accountRow) return { error: 'The mailbox this thread was sent from is no longer connected.' }
  const account = accountRow as EmailAccountRow

  const syncBefore = await syncEmailThread(supabase, thread)
  if (syncBefore.error) console.error('sendEmailReply: pre-send sync failed', syncBefore.error)
  const messages = await loadMessages(supabase, threadId)

  const latest = messages[messages.length - 1] ?? null
  const latestInbound = [...messages].reverse().find(m => m.direction === 'inbound') ?? null
  const subject = thread.subject
    ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`)
    : 'Re:'
  const to = latestInbound?.from_email ? [latestInbound.from_email] : parseEmailList(thread.to_emails)
  if (!to.length) return { error: 'This thread has no recipient to reply to.' }

  try {
    await providerFor(account).send(supabase, account, {
      to,
      cc: parseEmailList(thread.cc_emails),
      subject,
      bodyText: body,
      attachments: [],
      providerThreadId: thread.provider_thread_id,
      inReplyTo: latest?.message_id_header ?? undefined,
      references: messages.map(m => m.message_id_header).filter(Boolean).join(' ') || undefined,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { error: `The reply could not be sent: ${detail}` }
  }

  const syncAfter = await syncEmailThread(supabase, thread)
  if (syncAfter.error) console.error('sendEmailReply: post-send sync failed', syncAfter.error)
  await logActivity(supabase, verificationId, admin.email ?? '', `Replied in the email thread to ${to.join(', ')}`)
  revalidatePath(`/admin/${verificationId}`)
}

/**
 * Pull new replies for one thread. Deliberately NOT gated on the closed-case
 * rule: refreshing only mirrors provider state into admin-only tables, so
 * late replies stay readable on a closed case.
 */
export async function refreshEmailThread(verificationId: string, threadId: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const thread = await loadThread(supabase, verificationId, threadId)
  if (!thread) return { error: 'Could not load this thread. Please retry.' }
  const res = await syncEmailThread(supabase, thread)
  revalidatePath(`/admin/${verificationId}`)
  if (res.error) return { error: `Could not refresh the thread: ${res.error}` }
}

/** Pull new replies for every sent thread on this verification. */
export async function refreshVerificationEmails(verificationId: string): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const res = await syncVerificationThreads(supabase, verificationId)
  revalidatePath(`/admin/${verificationId}`)
  if (res.error) return { error: `Could not refresh the threads: ${res.error}` }
}

/**
 * Publish the thread into the Insurer Contact Log (first log) or refresh the
 * already-published entry with the latest messages (Update log). The result
 * is an ordinary contact note: editable and deletable through the existing
 * note UI, customer-visible only via the existing publish gating.
 */
export async function logEmailThreadToContactLog(verificationId: string, threadId: string, formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin()
  const supabase = createServiceClient()
  if (await caseClosed(supabase, verificationId)) return { error: CLOSED_ERROR }

  const thread = await loadThread(supabase, verificationId, threadId)
  if (!thread) return { error: 'Could not load this thread. Please retry.' }
  const sync = await syncEmailThread(supabase, thread)
  if (sync.error) console.error('logEmailThreadToContactLog: sync failed', sync.error)
  const messages = await loadMessages(supabase, threadId)
  if (!messages.length) return { error: 'Nothing to log yet: the thread has no messages.' }

  const summary_html = sanitizeSummaryHtml(String(formData.get('summary_html') ?? ''))
  const summary_text = summaryPlainText(summary_html)
  const transcript = formatThreadText(messages)

  const { data: v } = await supabase.from('verifications')
    .select('insurance_contact, contact_checks, call_notes, org_id, display_id')
    .eq('id', verificationId)
    .maybeSingle()
  if (!v) return { error: 'Could not load this verification. Please retry.' }

  const latestInbound = [...messages].reverse().find(m => m.direction === 'inbound') ?? null
  const savedContact = (v.insurance_contact ?? {}) as { name?: string; phone?: string; email?: string }
  const email = latestInbound?.from_email ?? parseEmailList(thread.to_emails)[0] ?? ''
  const contact = {
    name: latestInbound?.from_name || savedContact.name || '',
    phone: '',
    email,
  }
  const rawChecks = v.contact_checks
  const check_data = noteCheckFromRegistry(
    (Array.isArray(rawChecks) ? rawChecks : []) as ContactCheckEntry[],
    '',
    contactValue(contact.email),
  )

  if (thread.published_note_at) {
    // Update in place (owner decision 2026-08-05): one contact log entry per
    // thread, refreshed with the latest messages; `at` never changes.
    const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
    const existing = notes.find(n => n.at === thread.published_note_at)
    if (!existing) return { error: 'The logged entry for this thread was deleted. Delete and re-log is not supported; log a manual contact note instead.' }
    const updated: ContactNote = {
      ...existing,
      ...(summary_text ? { summary_html, summary_text } : {}),
      transcript,
      contact,
      ...(check_data ? { contact_check: check_data } : {}),
      edited_at: new Date().toISOString(),
    }
    const { error } = await supabase.rpc('admin_update_call_note', {
      vid: verificationId,
      note_at: thread.published_note_at,
      note_data: updated,
    })
    if (error) {
      console.error('logEmailThreadToContactLog: update failed', error)
      return { error: 'Could not update the contact log entry. Please retry.' }
    }
  } else {
    const { error } = await supabase.rpc('admin_publish_email_note', {
      p_thread_id: threadId,
      contact_method: 'email',
      summary_html,
      summary_text,
      transcript,
      contact,
      check_data,
      // Outreach emails log as AI contact (owner call 2026-08-06), matching
      // published AI calls.
      agent: 'ai',
    })
    if (error) {
      console.error('logEmailThreadToContactLog failed', error)
      return { error: 'Could not publish to the contact log. Please retry.' }
    }
    // Logged email threads land in the Activity feed too (feed-only insert).
    if (v.org_id) {
      await recordEvent(v.org_id as string, 'email.sent',
        { id: verificationId, display_id: v.display_id }, verificationId)
    }
  }
  revalidatePath(`/admin/${verificationId}`)
}
