import type { COIExtracted, ContactCheckEntry, OnlineListingStatus, Requirement } from '@/lib/types'

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

/**
 * Org-level call defaults (app_config), all editable per dispatch. Two
 * groups (owner decision 2026-07-27):
 * - IDENTITY: who the agent is — its name and the languages it can speak.
 * - LEGITIMACY: who the agent is affiliated with and what they do — the
 *   client's name, its relationship to the deal, a blurb about the client,
 *   and a reply email offered when the office wants to verify.
 * Deal-specific facts (certificate holder, addresses, VINs, policy numbers)
 * are NEVER org config: they change per COI and live in the per-call
 * reference details, prefilled from extraction.
 */
export interface OrgCallConfig {
  // Identity
  assistant_name: string
  assistant_last_name: string
  languages: string
  // Legitimacy
  on_behalf_of: string
  relationship_line: string
  on_behalf_of_info: string
  reply_email: string
}

export const DEFAULT_CALL_CONFIG: OrgCallConfig = {
  assistant_name: 'Sarah',
  // Insurer front desks routinely require a first AND last name before helping
  // (Progressive refused a first-name-only caller, 2026-07-28); the opener
  // still uses the first name alone, the full name is for when a rep asks.
  assistant_last_name: 'Mitchell',
  // English + Spanish at launch (a full pilot call ran in Spanish; the agent
  // mirrors the callee between these two only).
  languages: 'en,es',
  on_behalf_of: '',
  relationship_line: 'the certificate holder, extending credit to the policyholder',
  on_behalf_of_info: '',
  reply_email: '',
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
  'assistant_name', 'assistant_last_name', 'languages',
  'on_behalf_of', 'relationship_line', 'on_behalf_of_info', 'reply_email',
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
 * The stored agent_questions list, normalized. Two shapes coexist:
 * generated lists are plain strings (blockers inferred by keyword — policy
 * active/in force and VIN, the two fatal checks per the owner); curated lists
 * store {text, blocker} objects whose flags are trusted as saved. Either way
 * blockers sort to the front (stable), matching the gate-first call flow.
 */
export function defaultQuestionsFromAgentQuestions(raw: unknown): AiCallQuestion[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map((q): AiCallQuestion | null => {
      if (typeof q === 'string') {
        const text = q.trim()
        if (!text) return null
        const blocker = /\b(active|expired?|in force|cancell?ed)\b/i.test(text) || /\bvin\b/i.test(text)
        return blocker ? { text, blocker } : { text }
      }
      if (q && typeof q === 'object' && typeof (q as { text?: unknown }).text === 'string') {
        const text = (q as { text: string }).text.trim()
        if (!text) return null
        return (q as { blocker?: unknown }).blocker === true ? { text, blocker: true } : { text }
      }
      return null
    })
    .filter((q): q is AiCallQuestion => !!q)
  return [...normalized.filter(q => q.blocker), ...normalized.filter(q => !q.blocker)]
}

/**
 * True when agent_questions was saved by the admin editor (object entries)
 * rather than generated (plain strings). Curated lists survive extraction
 * re-runs: runExtractionPipeline checks this before regenerating.
 */
export function isCuratedQuestionList(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some(q => !!q && typeof q === 'object')
}

/** Render the question list into a plain numbered list. */
export function renderQuestions(questions: AiCallQuestion[]): string {
  return questions.map((q, i) => `${i + 1}. ${q.text.trim()}`).join('\n')
}

/** The N1 opening line exactly as the agent will speak it (owner wording
 *  2026-07-28: no "digital assistant" up front — that disclosure moves to the
 *  who-are-you answer, given only when the office asks). */
export function disclosurePreview(ctx: Pick<CallContextFields, 'assistant_name' | 'on_behalf_of' | 'insured_name'>): string {
  return `Hi, I'm ${ctx.assistant_name || '(assistant name)'} from ${ctx.on_behalf_of || '(on behalf of)'} calling on a recorded line to verify a certificate of insurance from ${ctx.insured_name || '(insured name)'}.`
}

/** A 17-character VIN (I, O, Q are never used in VINs). */
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g

/**
 * Every distinct VIN in the SUBMITTED STANDARDS only: template rows, manual
 * standards inputs, and resolved per-deal variables (all of which land in the
 * parsed requirement rows). VINs read off the COI are deliberately excluded
 * (owner call 2026-07-29, VRF-1083): a certificate can list a whole fleet,
 * but the call only concerns the vehicles the customer asked about.
 */
export function collectVins(requirements: Requirement[]): string[] {
  const vins = new Set<string>()
  const haystacks = requirements.flatMap(r => [r.coverage_type, r.minimum_limit, r.notes ?? ''])
  for (const text of haystacks) {
    for (const m of String(text ?? '').toUpperCase().matchAll(VIN_RE)) vins.add(m[0])
  }
  return [...vins]
}

/**
 * Org-level predefined reference details (settings → Calling → Reference
 * details), stored in app_config under `reference_details:<orgId>`. They are
 * prepended to every deal's prefilled reference details, ahead of the per-deal
 * facts computed from the COI/standards below.
 */
export const REFERENCE_DETAILS_KEY = 'reference_details'
export const referenceDetailsKey = (orgId: string) => `${REFERENCE_DETAILS_KEY}:${orgId}`

/** Tolerant read of a stored reference-details config value. */
export function parseReferenceDetails(value: unknown): ReferenceDetail[] {
  const raw = (value as { details?: unknown })?.details
  if (!Array.isArray(raw)) return []
  return raw
    .map((d): ReferenceDetail | null => {
      if (!d || typeof d !== 'object') return null
      const { label, value: v } = d as Record<string, unknown>
      if (typeof label !== 'string' || typeof v !== 'string') return null
      const trimmed = { label: label.trim(), value: v.trim() }
      return trimmed.label && trimmed.value ? trimmed : null
    })
    .filter((d): d is ReferenceDetail => !!d)
}

/** Prefill the editable context + questions + details + number panel from stored data. */
export function draftFromVerification(input: {
  displayId: string
  agentQuestions: unknown
  coi: COIExtracted | null
  requirements: Requirement[]
  contactChecks: ContactCheckEntry[]
  insuranceContact: { name?: string; phone?: string; email?: string } | null
  config: OrgCallConfig
  /** Org-level predefined rows (settings → Calling → Reference details). */
  orgDetails?: ReferenceDetail[]
}): { context: CallContextFields; questions: AiCallQuestion[]; numbers: NumberCandidate[]; details: ReferenceDetail[] } {
  const { coi, config } = input
  const context: CallContextFields = {
    ...config,
    insured_name: (coi?.named_insured ?? '').trim(),
    agency_name: (coi?.producer ?? '').trim(),
    agent_name: (coi?.insurance_company_contact ?? input.insuranceContact?.name ?? '').trim(),
    reference_id: input.displayId,
    call_context: 'new',
  }

  // Prefill reference details: the org's predefined rows first, then one row
  // per fact found on the COI extraction or in the submitted standards — a
  // computed row appears only when its value exists; the admin edits/adds/
  // removes rows freely per call.
  const details: ReferenceDetail[] = [...(input.orgDetails ?? [])]
  const push = (label: string, value: string | undefined) => {
    const v = (value ?? '').trim()
    if (v) details.push({ label, value: v })
  }
  const seenPolicy = new Set<string>()
  for (const c of coi?.coverages ?? []) {
    const num = (c.policy_number ?? '').trim()
    if (!num || seenPolicy.has(num)) continue
    seenPolicy.add(num)
    const type = (c.type ?? '').trim()
    details.push({ label: type ? `Policy number (${type})` : 'Policy number', value: num })
  }
  push('Insured address', coi?.named_insured_address)
  // Deal parties are per-COI facts, not org config: the certificate holder
  // (when this COI names one) rides as ordinary reference details the admin
  // can edit, replace with a loss payee row, or delete. Newer extractions
  // split the holder box into name + address; older ones have one string.
  const holderName = (coi?.certificate_holder_name ?? '').trim()
  if (holderName) {
    push('Certificate holder', holderName)
    push('Certificate holder address', coi?.certificate_holder_address)
  } else {
    push('Certificate holder', coi?.certificate_holder)
  }
  for (const vin of collectVins(input.requirements)) push('VIN', vin)
  push('USDOT number', coi?.usdot_number)
  push('MC number', coi?.mc_number)

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
    assistant_last_name: s(ctx.assistant_last_name),
    on_behalf_of: s(ctx.on_behalf_of),
    relationship_line: s(ctx.relationship_line),
    reply_email: s(ctx.reply_email),
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
  // Required since the Progressive refusal: reps demand a first and last name.
  { field: 'assistant_last_name', label: 'Assistant last name' },
  { field: 'on_behalf_of', label: 'On behalf of' },
  { field: 'relationship_line', label: 'Relationship line' },
  { field: 'insured_name', label: 'Insured name' },
  // reference_id and reply_email intentionally NOT required: legitimacy proof
  // points, spoken only if the office asks (flow nodes G1/N1q/N6c).
  { field: 'languages', label: 'Languages' },
]

/** Identity-core fields whose emptiness is worth flagging before dial.
 *  Insurer name/contact (agency_name / agent_name variables) are deliberately
 *  NOT here: many calls have no contact person, and a blank just means the
 *  agent says it does not have it (owner decision 2026-07-28). */
const LOOKUP_WARN_FIELDS: { field: keyof CallContextFields; label: string }[] = []

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
  // Configured question lists (settings → Calling → Questions List) can carry
  // per-deal {tokens} the admin fills in the AI tab; an unfilled one would be
  // spoken literally on the call.
  const withToken = realQuestions.filter(q => /\{[a-z0-9_]+\}/i.test(q.text))
  if (withToken.length > 0) {
    blocks.push(`Fill in the {placeholder} value${withToken.length > 1 ? 's' : ''} in the question list before dialing.`)
  }

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
