/**
 * Deterministic slot-filling conversation for creating a verification from a
 * Slack DM. No LLM: files and text answers fill slots in a fixed order
 * (COI file, carrier name, insurance requirements, optional rate confirmation).
 * Session state lives in slack_intake_sessions keyed by (team_id, channel_id).
 */
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { uploadDocument, downloadDocument } from '@/lib/storage'
import { createVerification, type VerificationFile } from '@/lib/verifications'
import { listTemplates, resolveTemplate, type RequirementTemplate } from '@/lib/templates'
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
  /** Saved standard selected by name; variables collected one at a time. */
  template_id?: string
  template_vars?: Record<string, string>
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
  // File captions are not answers; only plain text messages fill slots.
  if (text && !isSubmitWord(lower) && (!ev.files || ev.files.length === 0)) {
    const t = selectedTemplate()
    if (hasCoi && !state.carrier_name) {
      state.carrier_name = text
    } else if (hasCoi && state.carrier_name && t && missingVars(t).length > 0) {
      state.template_vars = { ...(state.template_vars ?? {}), [missingVars(t)[0].key]: text }
    } else if (hasCoi && state.carrier_name && !hasReqs) {
      // Tolerate a copied *bold* name keeping its mrkdwn asterisks.
      const replyName = lower.replace(/^\*+|\*+$/g, '').trim()
      const match = templates.find(x => x.name.trim().toLowerCase() === replyName)
      if (match) {
        state.template_id = match.id
        state.template_vars = {}
      } else {
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
    if (templates.length > 0) {
      const names = templates.map(t => `*${t.name}*${t.is_default ? ' (default)' : ''}`).join(', ')
      await say(
        `Got it. Which of your saved insurance standards do you want to use? ${names}. ` +
        'Copy ONE in your reply OR share new, custom standards.',
      )
    } else {
      await say('Got it. What insurance coverage do you require? (write out an explanation in your reply OR upload a document with your insurance standards)')
    }
    return
  }
  {
    const t = selectedTemplate()
    if (t && missingVars(t).length > 0) {
      const v = missingVars(t)[0]
      await say(`Using insurance standard: *${t.name}*. What is the ${v.label.toLowerCase()} for this deal?`)
      return
    }
  }
  if (!isSubmitWord(lower)) {
    await say('Great. Final step: attach any other relevant documents (up to 5, optional) OR reply *done* to submit this verification.')
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
      requirements = [{ type: 'text', value: resolved.text }, { type: 'template', ...resolved.provenance }]
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
