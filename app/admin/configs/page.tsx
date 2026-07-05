import { requireAdmin } from '@/lib/auth-helpers'
import { getExtractionConfig } from '@/lib/config'
import {
  DEFAULT_BASELINE_REQUIREMENTS,
  DEFAULT_COI_EXTRACTION_PROMPT,
  DEFAULT_DOC_TEXT_PROMPT,
  DEFAULT_REQUIREMENTS_PARSING_PROMPT,
} from '@/lib/claude'
import { C } from '@/lib/theme'
import { saveBaselineConfig, savePrompt } from './actions'

export const dynamic = 'force-dynamic'

export default async function AdminConfigs() {
  await requireAdmin()
  const cfg = await getExtractionConfig()

  const baseline = cfg.baselineRequirements?.length ? cfg.baselineRequirements : DEFAULT_BASELINE_REQUIREMENTS
  const baselineIsDefault = !cfg.baselineRequirements?.length
  // One trailing empty row = the "add" slot; saving with a name filled in keeps it.
  const rows = [...baseline, { coverage_type: '', minimum_limit: '', notes: '' }]

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
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>Configs</h1>
      <p style={{ color: C.txt2, fontSize: 14, margin: '4px 0 26px', lineHeight: 1.6 }}>
        Runtime settings for the verification pipeline. Changes apply to the next extraction run;
        already-analyzed verifications keep their stored results.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Baseline requirements */}
        <section>
          <SectionTitle>Baseline requirements</SectionTitle>
          <p style={hintStyle()}>
            Checked on every COI, on top of whatever the insurance standards and rate con state.
            Name is the label shown to customers; criteria tell the analyst (AI or you) exactly how
            to judge it. Use {'{carrier_name}'} in criteria to reference the verification&apos;s carrier.
            To delete a row, clear its name and save. Fill the empty bottom row to add one.
            {baselineIsDefault ? ' Currently using the built-in defaults.' : ' Currently using a custom list.'}
          </p>
          <form action={saveBaselineConfig} style={{ ...card(), display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="row_count" value={rows.length} />
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 12, borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input name={`b_${i}_type`} defaultValue={r.coverage_type} placeholder={i === rows.length - 1 ? 'New check name…' : 'Check name'} style={{ ...input(), flex: 2 }} />
                  <input name={`b_${i}_limit`} defaultValue={r.minimum_limit ?? ''} placeholder="Minimum limit (optional)" style={{ ...input(), flex: 1 }} />
                </div>
                <textarea name={`b_${i}_notes`} defaultValue={r.notes ?? ''} rows={2} placeholder="Pass criteria: when is this met, not met, or uncertain?" style={{ ...input(), resize: 'vertical' }} />
              </div>
            ))}
            <button type="submit" style={{ ...smallBtn(), alignSelf: 'flex-start' }}>Save baseline requirements</button>
          </form>
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
