import type { COIExtracted, ContactCheckEntry, OnlineListingStatus } from '@/lib/types'

/**
 * Pure builders + validators for the AI call dispatch payload. Deliberately
 * free of server imports: the pre-dial review form runs the exact same
 * validation in the browser that the dispatch action re-runs on the server.
 *
 * Variable names emitted by buildDynamicVariables are the single source of
 * truth for the {{variable}} names configured on the Retell agent — renaming
 * one here requires the same rename in the Retell dashboard.
 *
 * Data model (owner redesign 2026-07-24): a small IDENTITY CORE of fields the
 * flow speaks by name in verbatim lines, plus ONE generic reference_details
 * list for every certificate/deal fact (policy numbers, VINs, DOT, addresses,
 * MC numbers, LC numbers — whatever the vertical needs). Rows are label/value;
 * identifier-looking values get deterministic spoken and last-four hints
 * appended at render time, so recitation is never improvised and nothing is
 * hardcoded per fact type. Anything not in the list: the agent says it does
 * not have it.
 */

/**
 * One question for the voice agent, exactly as it should be asked.
 * `blocker` questions are asked FIRST, in the flow's gate node: a negative
 * answer (policy not active, vehicle not listed) ends the call immediately.
 */
export interface AiCallQuestion {
  text: string
  blocker?: boolean
}

/** One certificate/deal fact the agent may state: label + value, admin-edited. */
export interface ReferenceDetail {
  label: string
  value: string
}

/** Org-level identity defaults (app_config), all editable per dispatch. */
export interface OrgCallConfig {
  assistant_name: string
  on_behalf_of: string
  relationship_line: string
  holder_legal_name: string
  holder_address: string
  reply_email: string
  email_enabled: 'true' | 'false'
  on_behalf_of_info: string
  callback_number: string
  languages: string
  entity_type: 'agency' | 'carrier' | 'mga'
}

export const DEFAULT_CALL_CONFIG: OrgCallConfig = {
  assistant_name: 'Sarah',
  on_behalf_of: '',
  relationship_line: 'the certificate holder, extending credit to the policyholder',
  holder_legal_name: '',
  holder_address: '',
  reply_email: '',
  email_enabled: 'false',
  on_behalf_of_info: '',
  callback_number: '',
  // English + Spanish at launch (a full pilot call ran in Spanish; the agent
  // mirrors the callee between these two only).
  languages: 'en,es',
  entity_type: 'agency',
}

/**
 * The identity core: fields the flow's verbatim lines and identity answers
 * reference by name. Everything data-shaped lives in reference details.
 */
export interface CallContextFields extends OrgCallConfig {
  insured_name: string
  agency_name: string
  agent_name: string
  reference_id: string
  call_context: 'new' | 'resumed'
}

export const CONTEXT_FIELD_NAMES = [
  'assistant_name', 'on_behalf_of', 'relationship_line', 'holder_legal_name',
  'holder_address', 'reply_email', 'email_enabled', 'on_behalf_of_info',
  'callback_number', 'languages', 'entity_type',
  'insured_name', 'agency_name', 'agent_name',
  'reference_id', 'call_context',
] as const

export interface NumberCandidate {
  number: string
  source: 'coi' | 'contact_check'
  label: string
  status?: OnlineListingStatus
  checkedAt?: string
}

/** Normalize to E.164. US default: 10 digits get +1. Returns null if unparseable. */
export function normalizeE164(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/[^\d]/g, '')
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

const NATO: Record<string, string> = {
  a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot',
  g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima',
  m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo',
  s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey',
  x: 'Xray', y: 'Yankee', z: 'Zulu',
}

/** NATO-spelled form of a name: "D as in Delta, A as in Alpha; next word: ..." */
export function natoSpell(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.map(word =>
    Array.from(word)
      .map(ch => {
        const lower = ch.toLowerCase()
        if (NATO[lower]) return `${ch.toUpperCase()} as in ${NATO[lower]}`
        if (/\d/.test(ch)) return `the digit ${ch}`
        return null
      })
      .filter(Boolean)
      .join(', '),
  ).filter(Boolean).join('; next word: ')
}

/**
 * Deterministic speakable form of an identifier: letters and digits one at a
 * time, punctuation named, groups separated by periods.
 * "NTL-321510-F1" -> "N T L. dash. 3 2 1 5 1 0. dash. F 1"
 */
export function valueSpoken(raw: string): string {
  const entries = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  const spoken = entries.map(entry => {
    const runs: string[] = []
    let current = ''
    let kind: 'letter' | 'digit' | null = null
    const flush = () => {
      if (current) runs.push(Array.from(current).join(' '))
      current = ''
      kind = null
    }
    for (const ch of entry) {
      if (/[a-z]/i.test(ch)) {
        if (kind !== 'letter') flush()
        kind = 'letter'
        current += ch.toUpperCase()
      } else if (/\d/.test(ch)) {
        if (kind !== 'digit') flush()
        kind = 'digit'
        current += ch
      } else {
        flush()
        if (ch === '-') runs.push('dash')
        else if (ch === '/') runs.push('slash')
        else if (ch === '.') runs.push('dot')
        // Spaces and other separators just split runs.
      }
    }
    flush()
    return runs.join('. ')
  })
  return spoken.join('. Next: ')
}

/** Back-compat alias (older callers); same generator. */
export const policyNumbersSpoken = valueSpoken

/** An identifier-looking value: 6+ alphanumerics including a digit. */
function isIdentifier(value: string): boolean {
  const alnum = value.replace(/[^a-z0-9]/gi, '')
  return alnum.length >= 6 && /\d/.test(alnum)
}

/**
 * Render the reference details into the {{reference_details}} variable.
 * Identifier values get deterministic hints so the agent can lead with the
 * last four and recite any portion slowly without improvising:
 *   - VIN (2019 Freightliner): 1XKYD49X0MJ470445 [last four: 0 4 4 5 | spoken: 1. X K Y D. ...]
 * Rows with a blank value are dropped: the agent simply will not have that
 * fact and says so if asked (global rule: "I don't have that in front of me").
 */
export function renderReferenceDetails(details: ReferenceDetail[]): string {
  return details
    .filter(d => d.label.trim() && d.value.trim())
    .map(d => {
      const value = d.value.trim()
      if (!isIdentifier(value)) return `- ${d.label.trim()}: ${value}`
      const alnum = value.replace(/[^a-z0-9]/gi, '')
      const last4 = alnum.slice(-4).toUpperCase().split('').join(' ')
      // Long identifiers (VIN-length) are offered last-four-first; normal
      // identifiers (policy numbers, DOT) are given in full by default.
      const lead = alnum.length >= 15 ? `LEAD WITH LAST FOUR: ${last4} | full ` : `last four if asked: ${last4} | `
      return `- ${d.label.trim()}: ${value} [${lead}spoken: ${valueSpoken(value)}]`
    })
    .join('\n')
}

/**
 * Existing OCR question strings, verbatim, one per row. Questions about
 * policy-active status or the VIN are pre-marked as blockers (the two fatal
 * checks per the owner); the admin can flip any of them on the review screen.
 */
export function defaultQuestionsFromAgentQuestions(raw: unknown): AiCallQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is string => typeof q === 'string' && !!q.trim())
    .map(q => {
      const text = q.trim()
      const blocker = /\b(active|expired?|in force|cancell?ed)\b/i.test(text) || /\bvin\b/i.test(text)
      return blocker ? { text, blocker } : { text }
    })
}

/** Render the question list into a plain numbered list. */
export function renderQuestions(questions: AiCallQuestion[]): string {
  return questions.map((q, i) => `${i + 1}. ${q.text.trim()}`).join('\n')
}

/** The N1 disclosure line exactly as the agent will speak it. */
export function disclosurePreview(ctx: Pick<CallContextFields, 'assistant_name' | 'on_behalf_of'>): string {
  return `Hi, this is ${ctx.assistant_name || '(assistant name)'}, a digital assistant calling on behalf of ${ctx.on_behalf_of || '(on behalf of)'}, on a recorded line.`
}

/** Prefill the editable context + questions + details + number panel from stored data. */
export function draftFromVerification(input: {
  displayId: string
  agentQuestions: unknown
  coi: COIExtracted | null
  contactChecks: ContactCheckEntry[]
  insuranceContact: { name?: string; phone?: string; email?: string } | null
  config: OrgCallConfig
}): { context: CallContextFields; questions: AiCallQuestion[]; numbers: NumberCandidate[]; details: ReferenceDetail[] } {
  const { coi, config } = input
  const context: CallContextFields = {
    ...config,
    holder_legal_name: config.holder_legal_name || (coi?.certificate_holder ?? '').trim(),
    insured_name: (coi?.named_insured ?? '').trim(),
    agency_name: (coi?.producer ?? '').trim(),
    agent_name: (coi?.insurance_company_contact ?? input.insuranceContact?.name ?? '').trim(),
    reference_id: input.displayId,
    call_context: 'new',
  }

  // Prefill reference details from the extraction; the admin edits/adds rows
  // freely (e.g. one VIN row per vehicle — the extraction has no VIN field).
  const details: ReferenceDetail[] = []
  const seenPolicy = new Set<string>()
  for (const c of coi?.coverages ?? []) {
    const num = (c.policy_number ?? '').trim()
    if (!num || seenPolicy.has(num)) continue
    seenPolicy.add(num)
    const type = (c.type ?? '').trim()
    details.push({ label: type ? `Policy number (${type})` : 'Policy number', value: num })
  }
  const addr = (coi?.named_insured_address ?? '').trim()
  if (addr) details.push({ label: 'Insured address', value: addr })
  const usdot = (coi?.usdot_number ?? '').trim()
  if (usdot) details.push({ label: 'USDOT number', value: usdot })
  const mc = (coi?.mc_number ?? '').trim()
  if (mc) details.push({ label: 'MC number', value: mc })

  const numbers: NumberCandidate[] = []
  const seen = new Set<string>()
  const coiPhone = (coi?.insurance_company_phone ?? '').trim()
  if (coiPhone) {
    numbers.push({ number: coiPhone, source: 'coi', label: 'Listed on the COI' })
    seen.add(normalizeE164(coiPhone) ?? coiPhone)
  }
  // Newest check first; one candidate per distinct number.
  for (const entry of [...input.contactChecks].reverse()) {
    const phone = (entry.phone ?? '').trim()
    if (!phone) continue
    const key = normalizeE164(phone) ?? phone
    if (seen.has(key)) continue
    seen.add(key)
    numbers.push({
      number: phone,
      source: 'contact_check',
      label: 'Found by contact check',
      status: entry.phone_status,
      checkedAt: entry.checked_at,
    })
  }
  return { context, questions: defaultQuestionsFromAgentQuestions(input.agentQuestions), numbers, details }
}

/**
 * The dispatch payload. Every optional variable is present as '' (Retell
 * speaks a missing variable literally with braces); spoken/last-four hints
 * are generated deterministically inside reference_details, never improvised.
 */
export function buildDynamicVariables(
  ctx: CallContextFields,
  questions: AiCallQuestion[],
  details: ReferenceDetail[],
): Record<string, string> {
  const s = (v: unknown) => String(v ?? '').trim()
  return {
    assistant_name: s(ctx.assistant_name),
    on_behalf_of: s(ctx.on_behalf_of),
    relationship_line: s(ctx.relationship_line),
    holder_legal_name: s(ctx.holder_legal_name),
    holder_address: s(ctx.holder_address),
    reply_email: s(ctx.reply_email),
    email_enabled: ctx.email_enabled === 'true' ? 'true' : 'false',
    on_behalf_of_info: s(ctx.on_behalf_of_info),
    insured_name: s(ctx.insured_name),
    agency_name: s(ctx.agency_name),
    agent_name: s(ctx.agent_name),
    reference_id: s(ctx.reference_id),
    reference_details: renderReferenceDetails(details),
    // Blockers go to the flow's gate node (negative answer ends the call);
    // the rest run in the main question loop.
    gate_questions: renderQuestions(questions.filter(q => q.blocker)),
    questions: renderQuestions(questions.filter(q => !q.blocker)),
    entity_type: s(ctx.entity_type) || 'agency',
    call_context: ctx.call_context === 'resumed' ? 'resumed' : 'new',
    languages: s(ctx.languages) || 'en',
  }
}

export interface ValidationResult {
  blocks: string[]
  warnings: string[]
}

/** Variables that must never be blank (a blank one gets spoken as braces). */
const REQUIRED_FIELDS: { field: keyof CallContextFields; label: string }[] = [
  { field: 'assistant_name', label: 'Assistant name' },
  { field: 'on_behalf_of', label: 'On behalf of' },
  { field: 'relationship_line', label: 'Relationship line' },
  { field: 'insured_name', label: 'Insured name' },
  { field: 'reference_id', label: 'Reference ID' },
  // callback_number intentionally NOT required: return-call handling was
  // removed 2026-07-24 (no inbound agent on the number); the flow no longer
  // speaks it anywhere.
  { field: 'entity_type', label: 'Entity type' },
  { field: 'languages', label: 'Languages' },
]

/** Identity-core fields whose emptiness is worth flagging before dial. */
const LOOKUP_WARN_FIELDS: { field: keyof CallContextFields; label: string }[] = [
  { field: 'agency_name', label: 'Agency name' },
  { field: 'holder_legal_name', label: 'Certificate holder name' },
  { field: 'holder_address', label: 'Certificate holder address' },
]

/** Validation: hard blocks disable dispatch; warnings flag risky-but-legal payloads. */
export function validateDispatch(input: {
  context: CallContextFields
  questions: AiCallQuestion[]
  details: ReferenceDetail[]
  toNumber: string
  coiPhone?: string
  numberStatus?: OnlineListingStatus | null
}): ValidationResult {
  const { context, questions, details, toNumber } = input
  const blocks: string[] = []
  const warnings: string[] = []

  for (const { field, label } of REQUIRED_FIELDS) {
    if (!String(context[field] ?? '').trim()) blocks.push(`${label} is blank. Blank variables get spoken on the call.`)
  }

  const e164 = normalizeE164(toNumber)
  if (!e164) blocks.push('The number to dial is missing or not a valid US phone number.')

  const realQuestions = questions.filter(q => q.text.trim())
  if (realQuestions.length === 0) blocks.push('Add at least one question.')

  // email_enabled no longer gates anything in the flow (email-channel
  // promises were removed 2026-07-24); a blank reply_email is a warning below.

  for (const { field, label } of LOOKUP_WARN_FIELDS) {
    if (!String(context[field] ?? '').trim()) warnings.push(`${label} is blank. The agent will say it does not have it if asked.`)
  }
  const realDetails = details.filter(d => d.label.trim() && d.value.trim())
  if (realDetails.length === 0) {
    warnings.push('No reference details entered. The agent will have nothing to help the office locate the account.')
  }
  const emptyRows = details.filter(d => d.label.trim() && !d.value.trim()).length
  if (emptyRows > 0) {
    warnings.push(`${emptyRows} reference detail row${emptyRows > 1 ? 's have' : ' has'} a label but no value; the agent will not receive ${emptyRows > 1 ? 'them' : 'it'}.`)
  }
  if (!context.reply_email.trim()) {
    warnings.push('Reply email is blank. The agent cannot give an email address if the office asks for one.')
  }
  const coiE164 = input.coiPhone ? normalizeE164(input.coiPhone) : null
  if (e164 && coiE164 && e164 !== coiE164) {
    warnings.push('The number to dial differs from the number listed on the COI.')
  }
  if (e164 && input.numberStatus !== 'verified') {
    warnings.push(input.numberStatus === 'differs' || input.numberStatus === 'not_found'
      ? 'The latest contact check did not verify this number.'
      : 'This number has not been verified by a contact check.')
  }
  return { blocks, warnings }
}
