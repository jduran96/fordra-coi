/**
 * Deterministic slot-filling conversation for creating a verification from a
 * Slack DM. No LLM in the conversation itself: files and text answers fill
 * slots in a fixed order (COI file, carrier name, insurance requirements,
 * optional rate confirmation). One exception at submit time: a free-text
 * amendment to a saved standard is merged into its lines by
 * applyStandardAmendment (deterministic append fallback).
 * Session state lives in slack_intake_sessions keyed by (team_id, channel_id).
 */
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { uploadDocument, downloadDocument } from '@/lib/storage'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { editableRows, listTemplates, resolveTemplate, type RequirementTemplate } from '@/lib/templates'
import { applyStandardAmendment } from '@/lib/claude'
import { emitEvent } from '@/lib/webhooks'
import { serializeVerification } from '@/lib/api-auth'
import { downloadSlackFile, postMessage } from './slack'
import { validateUpload, UPLOAD_ALLOW, UPLOAD_MAX_BYTES } from '@/lib/upload-validation'

interface SlackFile {
  id: string
  name?: string
  mimetype?: string
  url_private_download?: string
}

export interface SlackMessageEvent {
  type: string
  subtype?: string
  bot_id?: string
  user?: string
  text?: string
  channel: string
  ts: string
  files?: SlackFile[]
}

export interface Installation {
  id: string
  team_id: string
  org_id: string
  bot_token: string
  bot_user_id: string
  allowed_slack_users: string[] | null
}

interface StoredFile {
  kind: 'coi' | 'rcs' | 'requirements'
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
}

interface SessionState {
  carrier_name?: string
  requirements_text?: string
  /** Saved standard selected by menu number, "yes", or exact name; variables collected one at a time. */
  template_id?: string
  template_vars?: Record<string, string>
  /** Free-text changes to the selected standard (the "edit" path); merged at submit. */
  template_amendment?: string
  /** Standards-step sub-state: 'pick' (choose by number, multi only), 'confirm'
   * (yes / edit / new on one standard), 'edit' (next reply is the change),
   * 'new' (next reply or doc is the new standards). Absent until the step starts. */
  standards_mode?: 'pick' | 'confirm' | 'edit' | 'new'
  /** The standard being confirmed or edited, before it becomes template_id. */
  pending_template_id?: string
  /** Set once "remind me" is used: later prompts stop offering it (the user
   * has already seen their standards in this request). */
  reminded?: boolean
  files: StoredFile[]
}

// One thing at a time: the greeting only asks for the COI; the flow asks for
// each remaining item in its own message as slots fill.
const HELP =
  'Hey there, let\'s start a new verification. Please upload the carrier\'s COI (pdf or image).'

/** Handle one DM message event end to end (called after the HTTP ack). */
export async function handleIntakeMessage(install: Installation, ev: SlackMessageEvent) {
  // Ignore our own messages and non-user noise.
  if (ev.bot_id || !ev.user) return
  if (ev.subtype && ev.subtype !== 'file_share') return

  const say = (text: string) => postMessage(install.bot_token, ev.channel, text)

  if (install.allowed_slack_users && !install.allowed_slack_users.includes(ev.user)) {
    await say(
      'Sorry, you are not authorized to create verification requests for this workspace. ' +
      `Ask your Fordra admin to whitelist your Slack ID: ${ev.user}`,
    )
    return
  }

  const svc = createServiceClient()
  const text = (ev.text ?? '').trim()
  const lower = text.toLowerCase()

  // Load the active session (expired sessions are treated as absent).
  const { data: existing } = await svc.from('slack_intake_sessions')
    .select('id, state, expires_at')
    .eq('team_id', install.team_id)
    .eq('channel_id', ev.channel)
    .maybeSingle()
  let sessionId = existing?.id as string | undefined
  let state: SessionState = { files: [], ...(existing?.state as SessionState | undefined) }
  if (existing && new Date(existing.expires_at as string) < new Date()) {
    await svc.from('slack_intake_sessions').delete().eq('id', existing.id)
    sessionId = undefined
    state = { files: [] }
  }

  if (['cancel', 'reset', 'start over'].includes(lower)) {
    if (sessionId) await svc.from('slack_intake_sessions').delete().eq('id', sessionId)
    await say('Okay, I cleared everything. Send a COI whenever you are ready to start a new request.')
    return
  }

  // No session and no files: greet with instructions.
  if (!sessionId && (!ev.files || ev.files.length === 0)) {
    await say(HELP)
    return
  }

  if (!sessionId) {
    sessionId = randomUUID()
    const { error } = await svc.from('slack_intake_sessions').insert({
      id: sessionId,
      team_id: install.team_id,
      channel_id: ev.channel,
      org_id: install.org_id,
      state,
    })
    if (error) {
      await say('Unexpected session error. Please contact a Fordra admin for help.')
      return
    }
  }

  // ---- Files: download from Slack now (URLs go stale), stash in the bucket.
  for (const f of ev.files ?? []) {
    if (!f.url_private_download) continue
    const name = f.name || `${f.id}.bin`
    let bytes: ArrayBuffer, contentType: string
    try {
      ({ bytes, contentType } = await downloadSlackFile(install.bot_token, f.url_private_download))
    } catch {
      await say(`I could not download "${name}" from Slack. Please try uploading it again.`)
      continue
    }
    const kind = classifyFile(state, name)
    if (kind === 'rcs' && state.files.filter(x => x.kind === 'rcs').length >= 5) {
      await say(`I can take up to 5 additional documents per verification, so I skipped "${name}".`)
      continue
    }
    const check = validateUpload(bytes, f.mimetype || contentType, UPLOAD_ALLOW[kind], UPLOAD_MAX_BYTES[kind])
    if (!check.ok) {
      await say(`I could not accept "${name}". ${check.error}`)
      continue
    }
    const path = `slack-intake/${sessionId}/${kind}-${name}`
    try {
      await uploadDocument(path, bytes, check.mimeType)
    } catch {
      // Re-upload of the same filename in one session hits upsert:false; treat as stored.
    }
    state.files = state.files.filter(x => x.storage_path !== path)
    state.files.push({ kind, storage_path: path, file_name: name, mime_type: check.mimeType, size_bytes: bytes.byteLength })
  }

  // The org's saved standards (templates) are offered by name at the
  // requirements step; a reply matching a name selects one.
  let templates: RequirementTemplate[] = []
  try {
    templates = await listTemplates(svc, install.org_id)
  } catch {
    // Standards stay free-text if templates cannot load.
  }
  const selectedTemplate = () => templates.find(t => t.id === state.template_id) ?? null
  const missingVars = (t: RequirementTemplate) =>
    (t.variables ?? []).filter(v => v.required && !(state.template_vars ?? {})[v.key]?.trim())

  // ---- Text answers fill the next empty slot (files from this message count).
  const hasCoi = state.files.some(f => f.kind === 'coi')
  const hasReqs = !!state.requirements_text || !!state.template_id || state.files.some(f => f.kind === 'requirements')
  // Feedback for the standards re-ask below, set while parsing this message.
  let standardsNote = ''
  let remind = false
  // True when this message was an answer to the standards question. "yes" is
  // both the confirm word AND a submit word, so without this flag confirming
  // a standard fell straight through the final isSubmitWord gate and
  // submitted the verification, skipping the optional-documents step.
  let standardsConsumedReply = false
  // File captions are not answers; only plain text messages fill slots. Submit
  // words are ignored as answers EXCEPT at the standards step, where "yes"
  // accepts the pending saved standard (never stored as free text; see below).
  const awaitingStandards = hasCoi && !!state.carrier_name && !hasReqs
  if (text && (!isSubmitWord(lower) || awaitingStandards) && (!ev.files || ev.files.length === 0)) {
    const t = selectedTemplate()
    if (hasCoi && !state.carrier_name) {
      state.carrier_name = text
    } else if (hasCoi && state.carrier_name && t && missingVars(t).length > 0) {
      state.template_vars = { ...(state.template_vars ?? {}), [missingVars(t)[0].key]: text }
    } else if (awaitingStandards) {
      standardsConsumedReply = true
      const { mode, pending } = resolveStandardsState(state, templates)
      if (isRemind(lower)) {
        remind = true
        state.reminded = true
      } else if (mode === 'pick') {
        const pick = parseStandardPick(text, templates)
        if (pick?.kind === 'choice') {
          state.pending_template_id = pick.template.id
          state.standards_mode = 'confirm'
        } else if (pick?.kind === 'bad_number') {
          standardsNote = `I do not have a standard number ${pick.number}. `
        } else if (isNewWord(lower)) {
          state.standards_mode = 'new'
        } else {
          standardsNote = 'Sorry, I did not catch that. '
        }
      } else if (mode === 'confirm' && pending) {
        if (isYes(lower)) {
          state.template_id = pending.id
          state.template_vars = {}
        } else if (isEditWord(lower)) {
          state.standards_mode = 'edit'
          state.pending_template_id = pending.id
        } else if (isNewWord(lower)) {
          state.standards_mode = 'new'
        } else {
          standardsNote = 'Sorry, I did not catch that. '
        }
      } else if (mode === 'edit' && pending) {
        if (isNewWord(lower)) {
          state.standards_mode = 'new'
        } else if (!isSubmitWord(lower)) {
          // The reply IS the change: use the pending standard with this edit.
          state.template_id = pending.id
          state.template_vars = {}
          state.template_amendment = text
        }
      } else if (!isSubmitWord(lower)) {
        // 'new': the reply IS the new standards.
        state.requirements_text = text
      }
    }
  }

  await svc.from('slack_intake_sessions')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // ---- Decide what to ask next (recompute after this message's updates).
  const nowHasCoi = state.files.some(f => f.kind === 'coi')
  const nowHasReqs = !!state.requirements_text || !!state.template_id || state.files.some(f => f.kind === 'requirements')

  if (!nowHasCoi) {
    await say('To get started I need the carrier\'s COI. Please upload it here (PDF or image).')
    return
  }
  if (!state.carrier_name) {
    await say('Received. What is the legal name of this carrier?')
    return
  }
  if (!nowHasReqs) {
    const { mode, pending } = resolveStandardsState(state, templates)
    if (mode === 'pick') {
      if (remind) {
        await say(
          `${templates.map(formatStandard).join('\n\n')}\n\n` +
          '*Please reply with ONE number to select a standard.* You can also reply "new" to specify new standards.',
        )
      } else {
        const menu = templates.map((t, i) => `${i + 1}. *${t.name}*${t.is_default ? ' (default)' : ''}`).join('\n')
        await say(
          `${standardsNote || 'Got it. '}You have ${templates.length} saved insurance standards:\n${menu}\n\n` +
          '*Please reply with ONE number to select a standard.* You can also reply "remind me" to see what each standard includes, or "new" to send new standards instead.',
        )
      }
    } else if (mode === 'confirm' && pending) {
      if (remind) {
        await say(
          `${formatStandard(pending)}\n\n\n` +
          'Do you want to use these?\n' +
          '• Reply "yes" if so\n' +
          '• Reply "edit" to make changes\n' +
          '• Reply "new" to specify new standards',
        )
      } else {
        const intro = templates.length === 1
          ? `${standardsNote || 'Got it. '}Do you want to use your saved insurance standard "${pending.name}"?`
          : `${standardsNote}You selected "${pending.name}". Do you want to use it?`
        await say(
          `${intro}\n` +
          '• Reply "yes" to use it\n' +
          '• Reply "remind me" to see this standard\n' +
          '• Reply "edit" to change something about it\n' +
          '• Reply "new" to send new standards',
        )
      }
    } else if (mode === 'edit' && pending) {
      if (remind) {
        await say(`${formatStandard(pending)}\n\nWhat do you want to change about these? (explain in plain English)`)
      } else {
        await say(
          'Sure thing. Please explain (in plain English) what you want to change about your saved standard.' +
          (state.reminded ? '' : ' You can also reply "remind me" if you want me to repeat your saved standards list.'),
        )
      }
    } else if (templates.length > 0) {
      // mode 'new' with saved standards: remind still shows them for reference.
      const ask = 'Great. Please explain (in plain English) what standards you want to use OR upload a document.'
      await say(remind ? `${templates.map(formatStandard).join('\n\n')}\n\n${ask}` : ask)
    } else {
      await say('Got it. What insurance coverage do you require? (write out an explanation in your reply OR upload a document with your insurance standards)')
    }
    return
  }
  {
    const t = selectedTemplate()
    if (t && missingVars(t).length > 0) {
      const v = missingVars(t)[0]
      const edited = state.template_amendment ? ' (with your edits)' : ''
      await say(`Using insurance standard: *${t.name}*${edited}. What is the ${v.label.toLowerCase()} for this deal?`)
      return
    }
  }
  if (!isSubmitWord(lower) || standardsConsumedReply) {
    const t = selectedTemplate()
    const ack = t ? `Using insurance standard: *${t.name}*${state.template_amendment ? ' (with your edits)' : ''}.` : 'Great.'
    await say(`${ack} Final step: attach any other relevant documents (up to 5, optional) OR reply *done* to submit this verification.`)
    return
  }

  // ---- Finalize: move bytes to the real verification paths via the shared creator.
  const files: VerificationFile[] = []
  for (const f of state.files) {
    const { bytes } = await downloadDocument(f.storage_path)
    files.push({ bytes, name: f.file_name, mimeType: f.mime_type, kind: f.kind })
  }
  let requirements: unknown = state.requirements_text ? [{ type: 'text', value: state.requirements_text }] : null
  const finalTemplate = selectedTemplate()
  if (finalTemplate) {
    try {
      const resolved = resolveTemplate(finalTemplate, {
        carrier_name: state.carrier_name!,
        ...(state.template_vars ?? {}),
      })
      let value = resolved.text
      if (state.template_amendment?.trim()) {
        // Merge the amendment INTO the standard's lines: appending it raw
        // would leave the amended line and its replacement as two conflicting
        // requirements under the strict one-per-line parse.
        const lines = await applyStandardAmendment(value.split('\n').map(l => l.trim()).filter(Boolean), state.template_amendment.trim())
        value = lines.join('\n')
      }
      requirements = [
        { type: 'text', value },
        { type: 'template', ...resolved.provenance, ...(state.template_amendment?.trim() ? { amendment: state.template_amendment.trim() } : {}) },
      ]
    } catch (e) {
      // Error detail stays in server logs; the user just needs a way out.
      console.error('slack intake: could not apply template', finalTemplate.id, e)
      await say('An error occurred while trying to apply that insurance standard. Reply "cancel" to start over.')
      return
    }
  }

  let verification: Record<string, unknown>, docRefs
  try {
    ({ verification, docRefs } = await createVerification(svc, {
      orgId: install.org_id,
      carrierName: state.carrier_name!,
      source: 'slack',
      requirements,
      templateId: finalTemplate?.id,
      files,
    }))
  } catch (e) {
    await say('Verification request encountered an error. Reply "cancel" to start over.')
    return
  }

  await svc.from('slack_intake_sessions').delete().eq('id', sessionId)
  await emitEvent(install.org_id, 'verification.created', serializeVerification(verification, docRefs))

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  await say(
    `Done! Verification request ${verification.display_id ?? ''} created for *${state.carrier_name}*. ` +
    `Our team will review it and publish the results to your Fordra portal: ${base}/app`,
  )
}

/** First file is the COI; while requirements are missing the next doc fills them; anything after is a rate confirmation. */
function classifyFile(state: SessionState, name: string): StoredFile['kind'] {
  const lower = name.toLowerCase()
  if (!state.files.some(f => f.kind === 'coi')) return 'coi'
  const hasReqs = !!state.requirements_text || !!state.template_id || state.files.some(f => f.kind === 'requirements')
  if (/rate|conf|rc\b/.test(lower) && !state.files.some(f => f.kind === 'rcs')) return 'rcs'
  if (!hasReqs) return 'requirements'
  return 'rcs'
}

function isSubmitWord(lower: string): boolean {
  return ['done', 'submit', 'yes', 'go', 'send it'].includes(lower)
}

// ─── Standards-step helpers ──────────────────────────────────────────────────

/** Reply-word matchers for the standards step. All take the lowercased reply. */
export const isYes = (s: string) => /^(?:yes|yep|yeah|y|sure|ok|okay|use it|use them)[.!]*$/.test(s)
export const isRemind = (s: string) => /^(?:remind me|remind|show me|repeat)[.!]*$/.test(s)
export const isEditWord = (s: string) => /^(?:edit|edit it|change|amend|make changes)[.!]*$/.test(s)
export const isNewWord = (s: string) => /^(?:new|new standards?|new ones?|other|none|no|nope)[.!]*$/.test(s)

/**
 * Resolve the standards-step sub-state, tolerating stale session data (a
 * pending standard that was deleted falls back to picking or free text).
 */
function resolveStandardsState(state: SessionState, templates: RequirementTemplate[]): {
  mode: 'pick' | 'confirm' | 'edit' | 'new'
  pending?: RequirementTemplate
} {
  const pending = templates.find(x => x.id === state.pending_template_id)
    ?? (templates.length === 1 ? templates[0] : undefined)
  let mode = state.standards_mode ?? (templates.length > 1 ? 'pick' : templates.length === 1 ? 'confirm' : 'new')
  if ((mode === 'confirm' || mode === 'edit') && !pending) mode = templates.length > 1 ? 'pick' : 'new'
  return { mode, pending }
}

/**
 * Parse a reply in 'pick' mode: ONE menu number ("2", "2.", "#2") or the exact
 * standard name. An out-of-menu number is reported so the user gets a
 * correction; anything else returns null and the menu is asked again.
 * Exported for tests only.
 */
export function parseStandardPick(text: string, templates: RequirementTemplate[]):
  | { kind: 'choice'; template: RequirementTemplate }
  | { kind: 'bad_number'; number: number }
  | null {
  // Tolerate a copied *bold* name keeping its mrkdwn asterisks.
  const clean = text.replace(/^\*+|\*+$/g, '').trim()
  const byName = templates.find(t => t.name.trim().toLowerCase() === clean.toLowerCase())
  if (byName) return { kind: 'choice', template: byName }
  const num = clean.match(/^#?(\d{1,2})[).:]?$/)
  if (num) {
    const n = Number(num[1])
    if (n >= 1 && n <= templates.length) return { kind: 'choice', template: templates[n - 1] }
    return { kind: 'bad_number', number: n }
  }
  return null
}

/** One saved standard, formatted for a "remind me" reply. Variable rows show
 *  their human label ("Asset Sale Price") instead of the raw {token}. */
function formatStandard(t: RequirementTemplate): string {
  const lines = editableRows(t).map(r => {
    const amount = r.minimum_limit.trim()
    const notes = (r.notes ?? '').trim()
    return `• ${r.coverage_type.trim()}${amount ? `: ${amount}` : ''}${notes ? ` (${notes})` : ''}`
  })
  if (t.details?.trim()) lines.push(`• Additional details: ${t.details.trim()}`)
  return `*${t.name}*\n${lines.join('\n')}`
}
