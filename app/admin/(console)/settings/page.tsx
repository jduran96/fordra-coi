import Link from 'next/link'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { getExtractionConfig } from '@/lib/config'
import {
  DEFAULT_COI_EXTRACTION_PROMPT,
  DEFAULT_DOC_TEXT_PROMPT,
  DEFAULT_REQUIREMENTS_PARSING_PROMPT,
  DEFAULT_ASSESSMENT_PROMPT,
  DEFAULT_INSURER_QUESTIONS_PROMPT,
} from '@/lib/claude'
import { STARTER_REQUIREMENTS, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'
import { C } from '@/lib/theme'
import { savePrompt } from './actions'
import OrgStandards from './OrgStandards'
import NotificationEmails from './NotificationEmails'
import CallConfigCard from './CallConfigCard'
import QuestionsListCard from './QuestionsListCard'
import ReferenceDetailsCard from './ReferenceDetailsCard'
import { CALL_CONFIG_KEY } from '@/lib/config'
import { parseReferenceDetails, REFERENCE_DETAILS_KEY, type OrgCallConfig, type ReferenceDetail } from '@/lib/call-config'
import { parseQuestionsConfig, QUESTIONS_CONFIG_KEY, type ConfiguredQuestion } from '@/lib/question-config'
import { NOTIFICATION_EMAILS_KEY, DEFAULT_NOTIFICATION_EMAILS } from '@/lib/notify'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'standards', label: 'Standards' },
  { key: 'ocr', label: 'OCR' },
  { key: 'calling', label: 'Calling' },
  { key: 'notifications', label: 'Notifications' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default async function AdminSettings({ searchParams }: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin()
  const rawTab = (await searchParams).tab
  const tab: TabKey = TABS.some(t => t.key === rawTab) ? (rawTab as TabKey) : 'standards'

  const cfg = await getExtractionConfig()

  // Service client (admin scope): list every org and every org's templates so
  // standards can be authored on a customer's behalf.
  const svc = createServiceClient()
  const { data: orgs, error: orgsError } = await svc.from('orgs').select('id, name').order('name')
  if (orgsError) throw new Error(`Could not load orgs: ${orgsError.message}`)
  const { data: templates, error: tplError } = await svc
    .from('requirement_templates')
    .select(TEMPLATE_SELECT)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (tplError) throw new Error(`Could not load templates: ${tplError.message}`)

  const { data: notifyRow, error: notifyError } = await svc
    .from('app_config').select('value').eq('key', NOTIFICATION_EMAILS_KEY).maybeSingle()
  if (notifyError) throw new Error(`Could not load notification settings: ${notifyError.message}`)
  const notifyEmails = typeof notifyRow?.value === 'string' ? notifyRow.value : ''

  // AI call identity config: global defaults + per-org overrides.
  const { data: callCfgRows, error: callCfgError } = await svc
    .from('app_config').select('key, value').like('key', `${CALL_CONFIG_KEY}%`)
  if (callCfgError) throw new Error(`Could not load call config: ${callCfgError.message}`)
  const callByOrg: Record<string, Partial<OrgCallConfig>> = {}
  for (const r of callCfgRows ?? []) {
    if (r.key.startsWith(`${CALL_CONFIG_KEY}:`)) callByOrg[r.key.slice(CALL_CONFIG_KEY.length + 1)] = r.value as Partial<OrgCallConfig>
  }

  // Org-level predefined reference details, keyed by org id.
  const { data: refCfgRows, error: refCfgError } = await svc
    .from('app_config').select('key, value').like('key', `${REFERENCE_DETAILS_KEY}:%`)
  if (refCfgError) throw new Error(`Could not load reference details configs: ${refCfgError.message}`)
  const refByOrg: Record<string, ReferenceDetail[]> = {}
  for (const r of refCfgRows ?? []) {
    const details = parseReferenceDetails(r.value)
    if (details.length) refByOrg[r.key.slice(REFERENCE_DETAILS_KEY.length + 1)] = details
  }

  // Questions List configs: one row per org+template pair, keyed "orgId:templateId".
  const { data: qCfgRows, error: qCfgError } = await svc
    .from('app_config').select('key, value').like('key', `${QUESTIONS_CONFIG_KEY}:%`)
  if (qCfgError) throw new Error(`Could not load questions configs: ${qCfgError.message}`)
  const questionsByKey: Record<string, ConfiguredQuestion[]> = {}
  for (const r of qCfgRows ?? []) {
    const parsed = parseQuestionsConfig(r.value)
    if (parsed) questionsByKey[r.key.slice(QUESTIONS_CONFIG_KEY.length + 1)] = parsed.questions
  }

  const prompts = [
    {
      which: 'coi',
      title: 'COI extraction (vision OCR)',
      hint: 'System prompt for reading the Certificate of Insurance into structured fields. Keep the JSON schema section intact; the pipeline parses the model output as JSON.',
      value: cfg.promptCoiExtraction,
      def: DEFAULT_COI_EXTRACTION_PROMPT,
    },
    {
      which: 'doc_text',
      title: 'Rate con & insurance standards (text OCR)',
      hint: 'Instruction used to pull raw text out of rate confirmation sheets and insurance-standards documents before requirements parsing.',
      value: cfg.promptDocTextExtraction,
      def: DEFAULT_DOC_TEXT_PROMPT,
    },
    {
      which: 'requirements',
      title: 'Requirements parsing',
      hint: 'System prompt that turns the extracted text into a requirement list. Output must stay a JSON array of {coverage_type, minimum_limit, notes}.',
      value: cfg.promptRequirementsParsing,
      def: DEFAULT_REQUIREMENTS_PARSING_PROMPT,
    },
    {
      which: 'assessment',
      title: 'Analysis (verdicts + summary)',
      hint: 'System prompt for the Analysis tab\'s Run analysis button: judges each requirement from the extracted COI and the contact log, and writes the draft summary. Keep the JSON output section intact.',
      value: cfg.promptAssessment,
      def: DEFAULT_ASSESSMENT_PROMPT,
    },
    {
      which: 'insurer_questions',
      title: 'Insurer call questions',
      hint: 'System prompt that drafts the insurer call questions from the parsed standards on each extraction run: one gathering question per standard row, two for a VIN row. Output must stay a JSON array of question strings.',
      value: cfg.promptInsurerQuestions,
      def: DEFAULT_INSURER_QUESTIONS_PROMPT,
    },
  ]

  return (
    <div style={{ fontFamily: C.sans, color: C.txt, maxWidth: 860 }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: '0 0 20px', fontWeight: 400 }}>Settings</h1>

      {/* Same segmented control as /app/settings and the /app/new mode picker. */}
      <nav className="fx-scroll-x" style={{ display: 'flex', background: C.paper, borderRadius: 8, padding: 2, border: `1px solid ${C.border}`, marginBottom: 26, width: 'fit-content', maxWidth: '100%' }}>
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/admin/settings?tab=${t.key}`}
            style={{
              fontSize: 12, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.02em',
              padding: '6px 14px', borderRadius: 6, textDecoration: 'none',
              background: t.key === tab ? C.txt : 'transparent',
              color: t.key === tab ? C.surface : C.txt3, transition: 'all 120ms',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'standards' && (
        <section>
          <SectionTitle>Org insurance standards</SectionTitle>
          <p style={hintStyle()}>
            Create or edit an insurance requirement standard on behalf of a customer org. It shows up
            on that org&apos;s Settings page immediately, where they can adjust it like their own.
          </p>
          <OrgStandards
            orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))}
            templates={(templates ?? []) as unknown as RequirementTemplate[]}
            starterRows={STARTER_REQUIREMENTS.map(r => ({ ...r }))}
          />
        </section>
      )}

      {tab === 'ocr' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {prompts.map(p => (
            <section key={p.which}>
              <SectionTitle>{p.title}</SectionTitle>
              <p style={hintStyle()}>{p.hint}{!p.value && ' Currently using the built-in default.'}</p>
              <form action={savePrompt.bind(null, p.which)} style={{ ...card(), display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  name="prompt"
                  defaultValue={p.value ?? p.def}
                  rows={Math.min(18, Math.max(4, (p.value ?? p.def).split('\n').length + 1))}
                  style={{ ...input(), resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.5 }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="submit" name="intent" value="save" style={smallBtn()}>Save prompt</button>
                  <button type="submit" name="intent" value="reset" style={{ ...smallBtn(), color: C.txt3 }}>Reset to default</button>
                </div>
              </form>
            </section>
          ))}
        </div>
      )}

      {tab === 'calling' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <section>
            <SectionTitle>AI call identity</SectionTitle>
            <p style={hintStyle()}>
              Who the agent is and who it calls on behalf of, per org. These prefill the
              pre-dial review screen; everything stays editable per call there.
            </p>
            <CallConfigCard
              orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))}
              byOrg={callByOrg}
            />
          </section>
          <section>
            <SectionTitle>Reference details</SectionTitle>
            <p style={hintStyle()}>
              Predefined rows the agent can give the office to locate the account, per org. They
              lead the pre-dial reference details on every deal, ahead of the rows pulled from the
              COI automatically (the card lists that logic).
            </p>
            <ReferenceDetailsCard
              orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))}
              byOrg={refByOrg}
            />
          </section>
          <section>
            <SectionTitle>Questions List</SectionTitle>
            <p style={hintStyle()}>
              The standard call questions for each insurance standard. New verifications on a
              standard with a saved list prefill their AI question list from it (still editable
              per deal); AI drafting then only covers special instructions and rows the list
              does not have a question for.
            </p>
            <QuestionsListCard
              orgs={(orgs ?? []).map(o => ({ id: o.id, name: o.name }))}
              templates={(templates ?? []) as unknown as RequirementTemplate[]}
              byKey={questionsByKey}
            />
          </section>
        </div>
      )}

      {tab === 'notifications' && (
        <section>
          <SectionTitle>New-submission email alerts</SectionTitle>
          <NotificationEmails current={notifyEmails || DEFAULT_NOTIFICATION_EMAILS.join(', ')} />
        </section>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 13, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>{children}</h2>
}
const hintStyle = () => ({ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: '6px 0 10px' })
const card = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 })
const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
