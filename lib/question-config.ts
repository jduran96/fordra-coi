import type { Requirement } from '@/lib/types'

/**
 * Per-org, per-template AI-call question lists (admin settings → Calling →
 * Questions List). One configured question per template requirement row; the
 * configured text prefills the verification's master question list instead of
 * an OCR generation pass, so repeat deals on the same standard skip the
 * hand-editing. Question text may embed {tokens}: tokens matching the
 * template's per-deal variables substitute automatically (e.g. {vin_number}),
 * and {<key>_lastN} derives the last N characters of one (e.g. {vin_last4});
 * any other {token} is left in the text for the admin to fill in the Call tab
 * before dialing (dispatch blocks while one remains).
 *
 * Stored in app_config under `questions_config:<orgId>:<templateId>`
 * (same registry + RLS as call_config). Client-safe module: pure helpers only.
 */

export const QUESTIONS_CONFIG_KEY = 'questions_config'
export const questionsConfigKey = (orgId: string, templateId: string) =>
  `${QUESTIONS_CONFIG_KEY}:${orgId}:${templateId}`

export interface ConfiguredQuestion {
  /** Match key: the template row's coverage_type at config time (may hold
   *  {tokens}). Empty for custom (free-standing) questions. */
  coverage_type: string
  /** Full row label snapshot ("Coverage: limit (notes)") shown in settings for drift spotting. */
  requirement: string
  /** The question, possibly with {tokens}. Blank = no configured question for this row. */
  question: string
  /** Default blocker: populates the flag the AI call's gate node reads (a
   *  negative answer ends the call). Still editable per deal in the Call tab. */
  blocker?: boolean
  /** Free-standing question not tied to any template requirement row: always
   *  populated, never counts as covering a requirement. */
  custom?: boolean
  /** Conditional second question, asked separately only when the main answer
   *  matches `condition` (same shape as AiCallQuestion.followUp; rides into
   *  the per-deal list verbatim, still editable in the Call tab). */
  followUp?: { condition: string; text: string }
}

export interface QuestionsListConfig {
  questions: ConfiguredQuestion[]
}

/** A {token} anywhere inside question text (template tokens or admin-invented). */
export const QUESTION_TOKEN_RE = /\{[a-z0-9_]+\}/i

/** Tolerant read of a stored config value; null when empty or unreadable. */
export function parseQuestionsConfig(value: unknown): QuestionsListConfig | null {
  const raw = (value as { questions?: unknown })?.questions
  if (!Array.isArray(raw)) return null
  const questions = raw
    .map((q): ConfiguredQuestion | null => {
      if (!q || typeof q !== 'object') return null
      const { coverage_type, requirement, question, blocker, custom, followUp } = q as Record<string, unknown>
      if (typeof coverage_type !== 'string' || typeof question !== 'string') return null
      const fu = followUp as { condition?: unknown; text?: unknown } | undefined
      const fuCondition = typeof fu?.condition === 'string' ? fu.condition.trim() : ''
      const fuText = typeof fu?.text === 'string' ? fu.text.trim() : ''
      return {
        coverage_type: coverage_type.trim(),
        requirement: typeof requirement === 'string' ? requirement : coverage_type.trim(),
        question: question.trim(),
        ...(blocker === true ? { blocker: true } : {}),
        ...(custom === true ? { custom: true } : {}),
        ...(fuCondition && fuText ? { followUp: { condition: fuCondition, text: fuText } } : {}),
      }
    })
    .filter((q): q is ConfiguredQuestion => !!q && (!!q.coverage_type || (!!q.custom && !!q.question)))
  return questions.length ? { questions } : null
}

/** Substitute known per-deal variable values into a configured question. */
export function applyQuestionTokens(question: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [k, val]) => acc.replaceAll(`{${k}}`, val.trim()),
    question,
  )
}

/** A derived {<key>_lastN} token: last N alphanumeric characters of another
 *  value, e.g. {vin_number_last4} from the {vin_number} variable. */
const DERIVED_LAST_N_RE = /\{([a-z0-9_]+)_last(\d{1,2})\}/gi

/**
 * Values for the {<key>_lastN} tokens found in `texts`, resolved on top of the
 * base variable values (VRF-1120: "VIN ending in {vin_last4}" used to be a
 * hand-edited placeholder on every Dakota deal). Any N works. The base key
 * resolves from the matching template variable; bare {vin_lastN} additionally
 * falls back to any vin-ish variable, then to the deal's submitted-standards
 * VIN when there is exactly ONE (pass collectVins output as opts.vins).
 * Unresolvable tokens are simply omitted, so they stay in the text and the
 * existing pre-dial/pre-send blocks ask the admin to fill them.
 * opts.spoken space-pads the characters ("1 2 3 4") so TTS reads them as
 * digits on calls; leave it off for text surfaces like email.
 */
export function deriveLastNValues(
  texts: (string | undefined)[],
  values: Record<string, string>,
  opts: { vins?: string[]; spoken?: boolean } = {},
): Record<string, string> {
  const derived: Record<string, string> = {}
  const byLowerKey = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v ?? '']))
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(DERIVED_LAST_N_RE)) {
      const token = m[0].slice(1, -1)
      if (derived[token] !== undefined || byLowerKey.has(token.toLowerCase())) continue
      const base = m[1].toLowerCase()
      let source = (byLowerKey.get(base) ?? '').trim()
      if (!source && base === 'vin') {
        source = ([...byLowerKey.entries()].find(([k, v]) => k.includes('vin') && v.trim())?.[1]
          ?? (opts.vins?.length === 1 ? opts.vins[0] : '')).trim()
      }
      const alnum = source.replace(/[^a-z0-9]/gi, '')
      if (!alnum) continue
      const lastN = alnum.slice(-Number(m[2])).toUpperCase()
      derived[token] = opts.spoken ? lastN.split('').join(' ') : lastN
    }
  }
  return derived
}

const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9{}]+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does a configured row's coverage_type cover this parsed requirement?
 * Compared after variable resolution, so a config key holding a {token}
 * matches any resolved value in that position.
 */
export function coverageMatches(configKey: string, candidate: string): boolean {
  const pattern = normalizeKey(configKey)
  const value = normalizeKey(candidate)
  if (!/\{[a-z0-9_]+\}/i.test(pattern)) return pattern === value
  const re = new RegExp(`^${pattern.split(/\{[a-z0-9_]+\}/i).map(escapeRe).join('.+')}$`)
  return re.test(value)
}

/** Parsed requirements NOT covered by the config: template edits since the
 *  config was saved, special instructions, and uploaded-doc standards. These
 *  still go through OCR question generation. */
export function uncoveredRequirements(
  config: QuestionsListConfig,
  requirements: Requirement[],
): Requirement[] {
  // Custom (free-standing) questions never cover a requirement row.
  const configured = config.questions.filter(q => q.question && !q.custom)
  return requirements.filter(r =>
    !configured.some(q => coverageMatches(q.coverage_type, r.coverage_type)),
  )
}

/**
 * Per-deal template variable values out of verifications.requirements
 * provenance: web submissions keep `variables` on the object, API/Slack on
 * the { type: 'template' } array entry.
 */
export function templateVariableValues(storedRequirements: unknown): Record<string, string> {
  const r = storedRequirements as
    | { variables?: Record<string, string> }
    | { type?: string; variables?: Record<string, string> }[]
    | null
  const vars = Array.isArray(r) ? r.find(x => x?.type === 'template')?.variables : r?.variables
  return vars && typeof vars === 'object' ? vars : {}
}
