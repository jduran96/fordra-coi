'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG_KEYS, callConfigOrgKey, setConfig, deleteConfig } from '@/lib/config'
import { NOTIFICATION_EMAILS_KEY } from '@/lib/notify'
import type { Requirement } from '@/lib/types'
import { normalizeRequirementRows } from '@/lib/templates'
import { questionsConfigKey, type ConfiguredQuestion } from '@/lib/question-config'
import { referenceDetailsKey, type ReferenceDetail } from '@/lib/call-config'

const PROMPT_KEYS: Record<string, string> = {
  coi: CONFIG_KEYS.promptCoiExtraction,
  doc_text: CONFIG_KEYS.promptDocTextExtraction,
  requirements: CONFIG_KEYS.promptRequirementsParsing,
  assessment: CONFIG_KEYS.promptAssessment,
  insurer_questions: CONFIG_KEYS.promptInsurerQuestions,
}

/** Save or reset one of the OCR prompts. Empty text or intent=reset restores the default. */
export async function savePrompt(which: string, formData: FormData) {
  await requireAdmin()
  const key = PROMPT_KEYS[which]
  if (!key) return
  const reset = String(formData.get('intent') || '') === 'reset'
  const text = String(formData.get('prompt') || '').trim()
  if (reset || !text) await deleteConfig(key)
  else await setConfig(key, text)
  revalidatePath('/admin/settings')
}

export interface NotifyEmailsState { ok?: boolean; error?: string }

/**
 * Save the new-submission alert recipients (comma-separated). Empty input
 * resets to the built-in default recipient.
 */
export async function saveNotificationEmails(_prev: NotifyEmailsState, formData: FormData): Promise<NotifyEmailsState> {
  await requireAdmin()
  const raw = String(formData.get('emails') || '').trim()
  if (!raw) {
    await deleteConfig(NOTIFICATION_EMAILS_KEY)
    revalidatePath('/admin/settings')
    return { ok: true }
  }
  const emails = raw.split(',').map(e => e.trim()).filter(Boolean)
  const bad = emails.find(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  if (bad) return { error: `"${bad}" is not a valid email address.` }
  await setConfig(NOTIFICATION_EMAILS_KEY, emails.join(', '))
  revalidatePath('/admin/settings')
  return { ok: true }
}

export interface OrgTemplateState { ok?: boolean; error?: string }

/**
 * Create or update an insurance-standards template on behalf of an org.
 * It appears on that org's /app Settings page, where they can edit it further.
 */
export async function saveOrgTemplate(_prev: OrgTemplateState, formData: FormData): Promise<OrgTemplateState> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()

  const id = String(formData.get('id') || '').trim()
  const orgId = String(formData.get('org_id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  if (!orgId) return { error: 'Pick an org.' }
  if (!name) return { error: 'Give the standard a name.' }

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
  // One default per org (partial unique index): clear the old one first, and
  // abort if that fails (the insert below would hit the index otherwise).
  if (isDefault) {
    const { error: clearErr } = await supabase.from('requirement_templates')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('is_default', true)
    if (clearErr) return { error: 'Could not save. Nothing was changed. Please retry.' }
  }

  const row = {
    org_id: orgId,
    name,
    requirements,
    variables,
    details,
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  }
  const { error } = id
    ? await supabase.from('requirement_templates').update(row).eq('id', id).eq('org_id', orgId)
    : await supabase.from('requirement_templates').insert({ ...row, created_by: admin.id })
  if (error) return { error: error.message }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteOrgTemplate(templateId: string): Promise<void> {
  await requireAdmin()
  const supabase = createServiceClient()
  const { error } = await supabase.from('requirement_templates').delete().eq('id', templateId)
  if (error) throw new Error(`Could not delete the template: ${error.message}`)
  revalidatePath('/admin/settings')
}

/**
 * Save one org+template Questions List (settings → Calling): the standard
 * question per requirement row that prefills the AI call question list on
 * every verification submitted against that template. Rows with a blank
 * question stay AI-drafted; an all-blank submission clears the config so the
 * template goes back to full AI drafting.
 */
export async function saveQuestionsConfig(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  const orgId = String(formData.get('org_id') || '').trim()
  const templateId = String(formData.get('template_id') || '').trim()
  if (!orgId || !templateId) return { error: 'Pick an org and a standard first.' }
  let rows: ConfiguredQuestion[]
  try {
    rows = JSON.parse(String(formData.get('questions') || '[]'))
  } catch {
    return { error: 'Could not read the question rows. Please retry.' }
  }
  const questions = rows
    .map(q => ({
      coverage_type: String(q?.coverage_type ?? '').trim(),
      requirement: String(q?.requirement ?? '').trim(),
      question: String(q?.question ?? '').trim(),
      ...(q?.blocker === true ? { blocker: true } : {}),
      ...(q?.custom === true ? { custom: true } : {}),
    }))
    // Template rows persist only with a question; custom rows have no
    // requirement key and persist on their question text alone.
    .filter(q => q.question && (q.coverage_type || q.custom))
  const key = questionsConfigKey(orgId, templateId)
  if (questions.length === 0) await deleteConfig(key)
  else await setConfig(key, { questions })
  revalidatePath('/admin/settings')
  return { ok: true }
}

/**
 * Save one org's predefined reference details (settings → Calling): rows
 * prepended to every pre-dial prefill for that org's verifications, ahead of
 * the per-deal facts computed from the COI. An all-blank submission clears
 * the org's config.
 */
export async function saveReferenceDetails(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  const orgId = String(formData.get('org_id') || '').trim()
  if (!orgId) return { error: 'Pick an org first.' }
  let rows: ReferenceDetail[]
  try {
    rows = JSON.parse(String(formData.get('details') || '[]'))
  } catch {
    return { error: 'Could not read the detail rows. Please retry.' }
  }
  const details = rows
    .map(d => ({ label: String(d?.label ?? '').trim(), value: String(d?.value ?? '').trim() }))
    .filter(d => d.label && d.value)
  const halfFilled = rows.some(d =>
    !!String(d?.label ?? '').trim() !== !!String(d?.value ?? '').trim())
  if (halfFilled) return { error: 'Every row needs both a label and a value (or remove the row).' }
  const key = referenceDetailsKey(orgId)
  if (details.length === 0) await deleteConfig(key)
  else await setConfig(key, { details })
  revalidatePath('/admin/settings')
  return { ok: true }
}

/**
 * Save the AI call identity config for one org. The global scope was removed
 * from the editor 2026-07-29 (owner call: every call has different context);
 * getCallConfig still merges any legacy `call_config` global row at read time.
 * Only non-blank fields are stored; blanks fall back to the built-in defaults.
 * An all-blank submission clears the org's override entirely.
 */
export async function saveCallConfig(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  const scope = String(formData.get('scope') || '').trim()
  if (!scope || scope === 'global') return { error: 'Pick an org first.' }
  const key = callConfigOrgKey(scope)

  const value: Record<string, string> = {}
  for (const field of [
    'assistant_name', 'assistant_last_name', 'languages',
    'on_behalf_of', 'relationship_line', 'on_behalf_of_info', 'reply_email',
  ]) {
    const v = String(formData.get(field) ?? '').trim()
    if (v) value[field] = v
  }
  const reply = value.reply_email
  if (reply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply)) {
    return { error: `"${reply}" is not a valid email address.` }
  }
  if (Object.keys(value).length === 0) await deleteConfig(key)
  else await setConfig(key, value)
  revalidatePath('/admin/settings')
  return { ok: true }
}
