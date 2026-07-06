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
import { emitEvent } from '@/lib/webhooks'
import { serializeVerification } from '@/lib/api-auth'
import { downloadSlackFile, postMessage } from './slack'

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
  files: StoredFile[]
}

// One thing at a time: the greeting only asks for the COI; the flow asks for
// each remaining item in its own message as slots fill.
const HELP =
  'Hi! I create insurance verification requests for Fordra. ' +
  'To get started, please upload the carrier\'s COI (PDF or image).'

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
      await say('Something went wrong on my end. Please try again in a moment.')
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
    const path = `slack-intake/${sessionId}/${kind}-${name}`
    try {
      await uploadDocument(path, bytes, f.mimetype || contentType)
    } catch {
      // Re-upload of the same filename in one session hits upsert:false; treat as stored.
    }
    state.files = state.files.filter(x => x.storage_path !== path)
    state.files.push({ kind, storage_path: path, file_name: name, mime_type: f.mimetype || contentType, size_bytes: bytes.byteLength })
  }

  // ---- Text answers fill the next empty slot (files from this message count).
  const hasCoi = state.files.some(f => f.kind === 'coi')
  const hasReqs = !!state.requirements_text || state.files.some(f => f.kind === 'requirements')
  // File captions are not answers; only plain text messages fill slots.
  if (text && !isSubmitWord(lower) && (!ev.files || ev.files.length === 0)) {
    if (hasCoi && !state.carrier_name) {
      state.carrier_name = text
    } else if (hasCoi && state.carrier_name && !hasReqs) {
      state.requirements_text = text
    }
  }

  await svc.from('slack_intake_sessions')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // ---- Decide what to ask next (recompute after this message's updates).
  const nowHasCoi = state.files.some(f => f.kind === 'coi')
  const nowHasReqs = !!state.requirements_text || state.files.some(f => f.kind === 'requirements')

  if (!nowHasCoi) {
    await say('To get started I need the carrier\'s COI. Please upload it here (PDF or image).')
    return
  }
  if (!state.carrier_name) {
    const names = state.files.map(f => `"${f.file_name}"`).join(', ')
    await say(`Got ${names}. What is the carrier\'s name?`)
    return
  }
  if (!nowHasReqs) {
    await say('Thanks. Now send the insurance requirements. Paste them as text or attach the requirements document (a rate confirmation with the insurance section works too).')
    return
  }
  if (!isSubmitWord(lower)) {
    const extras = state.files.filter(f => f.kind !== 'coi').map(f => f.file_name)
    await say(
      `I have everything I need for *${state.carrier_name}*` +
      (extras.length ? ` (extra docs: ${extras.join(', ')})` : '') +
      '. Attach a rate confirmation if you have one, or reply *done* to submit.',
    )
    return
  }

  // ---- Finalize: move bytes to the real verification paths via the shared creator.
  const files: VerificationFile[] = []
  for (const f of state.files) {
    const { bytes } = await downloadDocument(f.storage_path)
    files.push({ bytes, name: f.file_name, mimeType: f.mime_type, kind: f.kind })
  }
  const requirements = state.requirements_text ? [{ type: 'text', value: state.requirements_text }] : null

  let verification: Record<string, unknown>, docRefs
  try {
    ({ verification, docRefs } = await createVerification(svc, {
      orgId: install.org_id,
      carrierName: state.carrier_name!,
      source: 'slack',
      requirements,
      files,
    }))
  } catch (e) {
    await say(`I could not create the request: ${e instanceof Error ? e.message : 'unknown error'}. Reply *done* to retry or "cancel" to start over.`)
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
  const hasReqs = !!state.requirements_text || state.files.some(f => f.kind === 'requirements')
  if (/rate|conf|rc\b/.test(lower) && !state.files.some(f => f.kind === 'rcs')) return 'rcs'
  if (!hasReqs) return 'requirements'
  return 'rcs'
}

function isSubmitWord(lower: string): boolean {
  return ['done', 'submit', 'yes', 'go', 'send it'].includes(lower)
}
