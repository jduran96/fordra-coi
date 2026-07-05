import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { withRetry } from '@/lib/db'
import { signedUrl } from '@/lib/storage'
import { C } from '@/lib/theme'
import { deriveAdminStatus, adminStatusColor } from '@/lib/admin-status'
import { baselineRequirements } from '@/lib/claude'
import { getExtractionConfig } from '@/lib/config'
import PendingButton from '@/components/PendingButton'
import AssessmentForm from '@/components/AssessmentForm'
import { runExtraction, saveCallNote, saveAssessment } from '../actions'

export const dynamic = 'force-dynamic'

interface Requirement { coverage_type?: string; minimum_limit?: string; notes?: string | null }
interface GapItem { requirement: Requirement; status: 'met' | 'not_met' | 'uncertain'; evidence?: string }
interface Gap { met?: GapItem[]; not_met?: GapItem[]; uncertain?: GapItem[] }
interface CallNote { at: string; text: string; contact?: { name?: string; phone?: string; email?: string } }
interface COI {
  named_insured?: string
  named_insured_address?: string
  named_insured_phone?: string
  named_insured_email?: string
  usdot_number?: string
  mc_number?: string
  producer?: string
  insurance_company?: string
  insurance_company_address?: string
  insurance_company_phone?: string
  insurance_company_email?: string
  insurance_company_contact?: string
  certificate_holder?: string
  additional_insured?: string
}

function gapItems(g: Gap | null | undefined): GapItem[] {
  if (!g) return []
  return [...(g.not_met ?? []), ...(g.uncertain ?? []), ...(g.met ?? [])]
}

export default async function AdminDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAdmin()
  // Service client: the session client can't `select *` on verifications because
  // customer publish-gating is enforced with column-level grants on `authenticated`,
  // which also apply to the admin's session. Row access is safe: requireAdmin above.
  const supabase = createServiceClient()
  const { data: v, error } = await withRetry(() => supabase
    .from('verifications')
    .select('*, orgs(name)')
    .eq('id', id)
    .maybeSingle())
  if (!v) {
    if (error) throw new Error('Could not load this verification. Please retry.')
    notFound()
  }

  const { data: docs } = await supabase
    .from('documents')
    .select('id, kind, file_name, mime_type, storage_path, extracted, extraction_status')
    .eq('verification_id', id)

  const docsWithUrls = await Promise.all(
    (docs ?? []).map(async d => ({ ...d, url: await signedUrl(d.storage_path).catch(() => null) })),
  )

  // Manually entered standards come in two shapes: web submissions store
  // { text }, API submissions store [{ type: 'text', value }].
  const requirementsText = (() => {
    const r = v.requirements as { text?: string } | { type?: string; value?: string }[] | null
    if (Array.isArray(r)) return r.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n').trim()
    return (r?.text ?? '').trim()
  })()

  const adminStatus = deriveAdminStatus(v)
  const statusCol = adminStatusColor(adminStatus)
  const contact = (v.insurance_contact ?? {}) as { name?: string; phone?: string; email?: string }
  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as CallNote[]
  const coi = (v.coi_extracted ?? null) as COI | null

  // The review rows: prefer the admin's saved assessment, then the automated
  // analysis, then the baseline checklist so a fully manual review is possible.
  const reviewItems: GapItem[] = await (async () => {
    const fromFinal = gapItems(v.final_report as Gap | null)
    if (fromFinal.length) return fromFinal
    const fromGap = gapItems(v.gap_analysis as Gap | null)
    if (fromGap.length) return fromGap
    const cfg = await getExtractionConfig()
    return baselineRequirements(v.carrier_name, cfg.baselineRequirements).map(r => ({
      requirement: r, status: 'uncertain' as const, evidence: '',
    }))
  })()
  const summaryDefault = (v.final_report as { narrative_summary?: string } | null)?.narrative_summary ?? ''

  return (
    <div style={{ fontFamily: C.sans, color: C.txt, maxWidth: 860 }}>
      <Link href="/admin" style={{ color: C.txt2, fontSize: 14, textDecoration: 'none' }}>← Queue</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>{v.carrier_name}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusCol, background: `color-mix(in oklch, ${statusCol} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>{adminStatus}</span>
      </div>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 22px' }}>
        {v.display_id} · {(v.orgs as { name?: string } | null)?.name ?? '—'} · {v.source} · {new Date(v.created_at).toLocaleString()}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* 1 — Uploads */}
        <section>
          <SectionTitle>Uploads</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {docsWithUrls.length === 0 && <Muted>No documents uploaded.</Muted>}
            {docsWithUrls.map(d => (
              <div key={d.id} style={card()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.txt2 }}>{d.kind}</span>
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.txt, fontWeight: 600, fontSize: 13, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>View {d.file_name} ↗</a>}
                </div>
              </div>
            ))}
            {requirementsText && (
              <div style={card()}>
                <SectionTitle small>Insurance standards (submitted as text)</SectionTitle>
                <p style={{ fontSize: 14, color: C.txt, whiteSpace: 'pre-wrap', margin: 0 }}>{requirementsText}</p>
              </div>
            )}
          </div>
        </section>

        {/* 2 — OCR Analysis */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SectionTitle>OCR Analysis</SectionTitle>
            <form action={runExtraction.bind(null, id)} style={{ marginLeft: 'auto' }}>
              <PendingButton pendingLabel="Extracting… (can take a minute)" style={smallBtn()}>
                {v.coi_extracted ? 'Re-run extraction' : 'Run extraction'}
              </PendingButton>
            </form>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {!v.coi_extracted && <Muted>Not extracted yet. Run extraction to parse the COI & requirements.</Muted>}
            {coi && <InsurerCard coi={coi} />}
            <JsonCard title="Requirements (normalized)" data={v.requirements_normalized} />
            <JsonCard title="Coverage gap analysis" data={v.gap_analysis} />
            <JsonCard title="COI extracted" data={v.coi_extracted} />
          </div>
        </section>

        {/* 3 — Verification call notes */}
        <section>
          <SectionTitle>Verification call notes</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {notes.length > 0 && (
              <div style={{ ...card(), overflowX: 'auto' }}>
                <SectionTitle small>Saved notes</SectionTitle>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <th style={thN()}>When</th><th style={thN()}>Contact</th><th style={thN()}>Phone</th><th style={thN()}>Email</th><th style={thN()}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.slice().reverse().map((n, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                        <td style={{ ...tdN(), whiteSpace: 'nowrap', color: C.txt3 }}>{new Date(n.at).toLocaleString()}</td>
                        <td style={tdN()}>{n.contact?.name?.trim() || '—'}</td>
                        <td style={{ ...tdN(), whiteSpace: 'nowrap' }}>{n.contact?.phone?.trim() || '—'}</td>
                        <td style={tdN()}>{n.contact?.email?.trim() || '—'}</td>
                        <td style={{ ...tdN(), color: C.txt, whiteSpace: 'pre-wrap', minWidth: 220, lineHeight: 1.55 }}>{n.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <form action={saveCallNote.bind(null, id)} style={{ ...card(), display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input name="contact_name" defaultValue={contact.name} placeholder="Insurer contact name" style={input()} />
              <input name="contact_phone" defaultValue={contact.phone} placeholder="Phone" style={input()} />
              <input name="contact_email" defaultValue={contact.email} placeholder="Email" style={input()} />
              <textarea name="note" rows={4} placeholder="What the insurer confirmed on this call…" style={{ ...input(), resize: 'vertical' }} />
              <PendingButton pendingLabel="Saving…" style={{ ...smallBtn(), alignSelf: 'flex-start', marginTop: 2 }}>Save note</PendingButton>
            </form>
          </div>
        </section>

        {/* 4 — Assessment & publish */}
        <section>
          <SectionTitle>Assessment</SectionTitle>
          <p style={{ fontSize: 13.5, color: C.txt2, lineHeight: 1.6, margin: '8px 0 10px' }}>
            Set a verdict and evidence for each requirement, write the summary, then save a draft
            or publish. Publishing releases exactly this assessment to the customer.
          </p>
          <AssessmentForm
            action={saveAssessment.bind(null, id)}
            items={reviewItems}
            summaryDefault={summaryDefault}
            published={!!v.published_at}
          />
        </section>
      </div>
    </div>
  )
}

function InsurerCard({ coi }: { coi: COI }) {
  const facts: [string, string | undefined][] = [
    ['Policyholder', coi.named_insured],
    ['Policyholder address', coi.named_insured_address],
    ['Policyholder phone', coi.named_insured_phone],
    ['Policyholder email', coi.named_insured_email],
    ['USDOT number', coi.usdot_number],
    ['MC number', coi.mc_number],
    ['Insurance company(s)', coi.insurance_company],
    ['Insurer contact name(s)', coi.insurance_company_contact],
    ['Producer (agency)', coi.producer],
    ['Address', coi.insurance_company_address],
    ['Phone', coi.insurance_company_phone],
    ['Email', coi.insurance_company_email],
    ['Certificate holder', coi.certificate_holder],
    ['Additional insured(s)', coi.additional_insured],
  ]
  const shown = facts.filter(([, val]) => !!val?.trim())
  if (!shown.length) return null
  return (
    <div style={card()}>
      <SectionTitle small>Insurer contact</SectionTitle>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
        {shown.map(([label, val]) => (
          <FactRow key={label} label={label} value={val!} />
        ))}
      </dl>
    </div>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ fontSize: 13, color: C.txt3 }}>{label}</dt>
      <dd style={{ fontSize: 13.5, color: C.txt, margin: 0, fontWeight: 500 }}>{value}</dd>
    </>
  )
}

function JsonCard({ title, data }: { title: string; data: unknown }) {
  return (
    <div style={card()}>
      <SectionTitle small>{title}</SectionTitle>
      {data ? (
        <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: C.txt2, background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, overflowX: 'auto', margin: 0, maxHeight: 280 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : <Muted>—</Muted>}
    </div>
  )
}
function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h2 style={{ fontSize: small ? 12 : 13, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: small ? '0 0 8px' : 0 }}>{children}</h2>
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: C.txt3, fontSize: 13.5, margin: 0 }}>{children}</p>
}
const card = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 })
const thN = () => ({ padding: '6px 12px 6px 0', fontWeight: 600 as const })
const tdN = () => ({ padding: '9px 12px 9px 0', color: C.txt2 })
const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const smallBtn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const primaryBtn = () => ({ padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer' })
