import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { getExtractionConfig } from '@/lib/config'
import {
  DEFAULT_COI_EXTRACTION_PROMPT,
  DEFAULT_DOC_TEXT_PROMPT,
  DEFAULT_REQUIREMENTS_PARSING_PROMPT,
} from '@/lib/claude'
import { STARTER_REQUIREMENTS, TEMPLATE_SELECT, type RequirementTemplate } from '@/lib/templates'
import { C } from '@/lib/theme'
import { savePrompt } from './actions'
import OrgStandards from './OrgStandards'

export const dynamic = 'force-dynamic'

export default async function AdminSettings() {
  await requireAdmin()
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
  ]

  return (
    <div style={{ fontFamily: C.sans, color: C.txt, maxWidth: 860 }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>Settings</h1>
      <p style={{ color: C.txt2, fontSize: 14, margin: '4px 0 26px', lineHeight: 1.6 }}>
        Runtime settings for the verification pipeline. Changes apply to the next extraction run;
        already-analyzed verifications keep their stored results.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Org insurance standards */}
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

        {/* Prompts */}
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
