import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { signedUrl } from '@/lib/storage'
import { C, statusColor } from '@/lib/theme'
import DownloadReportButton from '@/components/DownloadReportButton'

export const dynamic = 'force-dynamic'

interface GapItem {
  requirement: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status: 'met' | 'not_met' | 'uncertain'
  evidence?: string
}
interface Gap { met?: GapItem[]; not_met?: GapItem[]; uncertain?: GapItem[] }
interface Coverage {
  type?: string
  insurer?: string
  policy_number?: string
  effective_date?: string
  expiration_date?: string
  each_occurrence_limit?: string
  aggregate_limit?: string
  conditions_and_exceptions?: string
}
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
  certificate_holder?: string
  additional_insured?: string
  additional_terms?: string
  coverages?: Coverage[]
}

function gapItems(g: Gap | null | undefined): GapItem[] {
  if (!g) return []
  return [...(g.not_met ?? []), ...(g.uncertain ?? []), ...(g.met ?? [])]
}

export default async function CustomerVerification({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: v, error } = await withRetry(() => supabase
    .from('my_verifications')
    .select('*')
    .eq('id', id)
    .maybeSingle())
  if (!v) {
    if (error) throw new Error('Could not load this verification. Please retry.')
    notFound()
  }

  // Original submission (source of truth for the customer): RLS scopes this to their org.
  const { data: docs } = await supabase
    .from('documents')
    .select('id, kind, file_name, storage_path')
    .eq('verification_id', id)
  const docsWithUrls = await Promise.all(
    (docs ?? []).map(async d => ({ ...d, url: await signedUrl(d.storage_path).catch(() => null) })),
  )
  // Manually entered standards come in two shapes: web submissions store
  // { text }, API submissions store [{ type: 'text', value }]. Template-based
  // submissions add provenance ({ template_name, ... }) alongside the text.
  const req = v.requirements as ({ text?: string; template_name?: string } | { type?: string; value?: string }[] | null)
  const requirementsText = (() => {
    if (Array.isArray(req)) return req.filter(x => x?.type === 'text' && x.value).map(x => x.value).join('\n').trim()
    return (req?.text ?? '').trim()
  })()
  const templateName = (!Array.isArray(req) && req?.template_name) ? String(req.template_name).trim() : ''

  const published = !!v.published_at
  // Rejection wins over any leftover published state: the admin closed this
  // request, so no report renders. The view exposes case_status; the analysis
  // columns are already nulled because reject clears published_at.
  const rejected = v.case_status === 'rejected'
  const report = v.final_report as ({ narrative_summary?: string } & Gap) | null
  const coi = (v.coi_extracted ?? null) as COI | null
  // The customer always sees one format, whichever produced the verdicts:
  // the admin's reviewed final_report wins; the automated gap analysis is the fallback.
  const finalItems = gapItems(report)
  const items: GapItem[] = finalItems.length ? finalItems : gapItems((v.gap_analysis ?? null) as Gap | null)

  const displayStatus = rejected ? 'rejected' : v.status

  return (
    <div style={{ maxWidth: 760, fontFamily: C.sans, color: C.txt }}>
      <style>{`@media print {
        header, .no-print { display: none !important; }
        body { background: #fff !important; }
      }`}</style>
      <Link href="/app" className="no-print" style={{ color: C.txt2, fontSize: 14, textDecoration: 'none' }}>← Verifications</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>{v.carrier_name}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(displayStatus), background: `${statusColor(displayStatus)}1a`, padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize' }}>{displayStatus}</span>
        {published && !rejected && <DownloadReportButton />}
      </div>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 24px' }}>{v.display_id} · submitted {new Date(v.created_at).toLocaleString()}</p>

      {rejected ? (
        <div style={cardC()}>
          <p style={{ color: C.txt2, fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>
            This verification request was rejected by a Fordra admin. Contact us to learn more.
          </p>
        </div>
      ) : !published ? (
        <div style={cardC()}>
          <p style={{ color: C.txt2, fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>
            This verification is <strong style={{ color: C.txt }}>in review</strong>. We’re confirming
            the certificate with the insurer. You’ll see the full result here once it’s published.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {report?.narrative_summary && (
            <div style={cardC()}>
              <h2 style={h2C()}>Summary</h2>
              <p style={{ color: C.txt, fontSize: 14.5, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{report.narrative_summary}</p>
            </div>
          )}

          {items.length > 0 && (
            <>
              <SummaryStats items={items} />
              <div style={cardC()}>
                <h2 style={h2C()}>Requirement check</h2>
                {items.map((item, i) => (
                  <div key={i} style={{
                    padding: '15px 0',
                    borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none',
                    display: 'flex', gap: 16, alignItems: 'flex-start',
                  }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.txt, margin: '0 0 5px' }}>
                        {item.requirement?.coverage_type || 'Requirement'}
                        {item.requirement?.minimum_limit && (
                          <span style={{ fontWeight: 400, color: C.txt3 }}> · {item.requirement.minimum_limit}</span>
                        )}
                      </p>
                      {item.evidence && (
                        <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: 0 }}>{item.evidence}</p>
                      )}
                    </div>
                    <StatusTag status={item.status} />
                  </div>
                ))}
              </div>
            </>
          )}

          {coi && <CertificateCard coi={coi} />}
          <CallNotesCard notes={(Array.isArray(v.call_notes) ? v.call_notes : []) as CallNote[]} />
          <SubmittedCard docs={docsWithUrls} requirementsText={requirementsText} templateName={templateName} />
        </div>
      )}
    </div>
  )
}

/** Calls made to the insurer during review, newest first. */
function CallNotesCard({ notes }: { notes: CallNote[] }) {
  return (
    <div style={cardC()}>
      <h2 style={h2C()}>Insurer call notes</h2>
      {notes.length === 0 ? (
        <p style={{ fontSize: 13.5, color: C.txt3, margin: 0 }}>No calls made.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={thC()}>When</th><th style={thC()}>Contact</th><th style={thC()}>Phone</th><th style={thC()}>Email</th><th style={thC()}>Note</th>
              </tr>
            </thead>
            <tbody>
              {notes.slice().reverse().map((n, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                  <td style={{ ...tdC(), whiteSpace: 'nowrap', color: C.txt3 }}>{new Date(n.at).toLocaleString()}</td>
                  <td style={tdC()}>{n.contact?.name?.trim() || '—'}</td>
                  <td style={{ ...tdC(), whiteSpace: 'nowrap' }}>{n.contact?.phone?.trim() || '—'}</td>
                  <td style={tdC()}>{n.contact?.email?.trim() || '—'}</td>
                  <td style={{ ...tdC(), color: C.txt, whiteSpace: 'pre-wrap', minWidth: 220, lineHeight: 1.55 }}>{n.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * What the customer originally submitted: links to each uploaded document plus
 * any manually entered insurance standards. Standardized rows; absent items say
 * so explicitly rather than disappearing.
 */
function SubmittedCard({
  docs,
  requirementsText,
  templateName,
}: {
  docs: { id: string; kind: string; file_name: string; url: string | null }[]
  requirementsText: string
  templateName: string
}) {
  const byKind = (kind: string) => docs.filter(d => d.kind === kind)
  const rows: [string, { file_name: string; url: string | null }[]][] = [
    ['COI document', byKind('coi')],
    ['Rate confirmation', byKind('rcs')],
    ['Insurance standards', byKind('requirements')],
  ]
  // How the standards arrived, shown when no standards file was uploaded.
  const standardsFallback = templateName
    ? `Used template: ${templateName}`
    : requirementsText ? 'Entered manually' : 'Not submitted'
  return (
    <div style={cardC()}>
      <h2 style={h2C()}>What you submitted</h2>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 20, rowGap: 8 }}>
        {rows.map(([label, files]) => (
          <SubmittedRow key={label} label={label} files={files}
            fallback={label === 'Insurance standards' ? standardsFallback : 'Not submitted'} />
        ))}
      </dl>
      {requirementsText && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Insurance standards</h3>
          <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>{requirementsText}</p>
        </div>
      )}
    </div>
  )
}

function SubmittedRow({
  label,
  files,
  fallback,
}: {
  label: string
  files: { file_name: string; url: string | null }[]
  fallback: string
}) {
  return (
    <>
      <dt style={{ fontSize: 13, color: C.txt3 }}>{label}</dt>
      <dd style={{ fontSize: 13.5, color: C.txt, margin: 0, fontWeight: 500 }}>
        {files.length === 0
          ? fallback
          : files.map((f, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {f.url
                  ? <a href={f.url} target="_blank" rel="noreferrer" style={{ color: C.txt, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>{f.file_name} ↗</a>
                  : f.file_name}
              </span>
            ))}
      </dd>
    </>
  )
}

function SummaryStats({ items }: { items: GapItem[] }) {
  const disc = items.filter(i => i.status === 'not_met').length
  const miss = items.filter(i => i.status === 'uncertain').length
  const stats = [
    { n: items.length, label: 'Checks', color: C.txt },
    { n: disc, label: 'Discrepancies', color: disc === 0 ? C.ok : C.error },
    { n: miss, label: 'Unconfirmed', color: miss === 0 ? C.ok : C.warn },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          padding: '18px 14px', textAlign: 'center' as const, background: C.surface,
          border: `1px solid color-mix(in oklch, ${s.color} 25%, transparent)`, borderRadius: 12,
        }}>
          <p style={{ fontFamily: C.serif, fontSize: 38, fontWeight: 400, color: s.color, lineHeight: 1, margin: 0 }}>{s.n}</p>
          <p style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: 'uppercase' as const, letterSpacing: '0.07em', margin: '6px 0 0' }}>{s.label}</p>
        </div>
      ))}
    </div>
  )
}

function StatusTag({ status }: { status: GapItem['status'] }) {
  const map = {
    met:       { label: 'Satisfied',   color: C.ok },
    not_met:   { label: 'Discrepancy', color: C.error },
    uncertain: { label: 'Unconfirmed', color: C.warn },
  } as const
  const s = map[status] ?? map.uncertain
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, color: s.color, whiteSpace: 'nowrap',
      background: `color-mix(in oklch, ${s.color} 12%, transparent)`,
      padding: '3px 10px', borderRadius: 20,
    }}>{s.label}</span>
  )
}

/**
 * COI Details is a STANDARDIZED layout: every published verification renders the
 * same three blocks (facts, coverage table, additional terms) in the same order,
 * with explicit placeholders when the certificate lacks a field. Do not make
 * sections conditionally disappear; customers compare verifications side by side.
 */
function CertificateCard({ coi }: { coi: COI }) {
  const facts: [string, string | undefined][] = [
    ['Policyholder (named insured)', coi.named_insured],
    ['Policyholder address', coi.named_insured_address],
    ['Policyholder phone', coi.named_insured_phone],
    ['Policyholder email', coi.named_insured_email],
    ['USDOT number', coi.usdot_number],
    ['MC number', coi.mc_number],
    ['Insurance company', coi.insurance_company],
    ['Producer (agency)', coi.producer],
    ['Certificate holder', coi.certificate_holder],
    ['Additional insured', coi.additional_insured],
  ]
  const coverages = (coi.coverages ?? []).filter(c => c.type)

  return (
    <div style={cardC()}>
      <h2 style={h2C()}>COI Details</h2>
      <dl style={{ margin: '0 0 4px', display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 20, rowGap: 8 }}>
        {facts.map(([label, val]) => (
          <FactRow key={label} label={label} value={val?.trim() || '—'} />
        ))}
      </dl>
      {coverages.length === 0 && (
        <p style={{ fontSize: 13, color: C.txt3, margin: '14px 0 0' }}>No coverages extracted from the certificate.</p>
      )}
      {coverages.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={thC()}>Coverage</th><th style={thC()}>Policy #</th><th style={thC()}>Effective</th><th style={thC()}>Expires</th><th style={thC()}>Per occurrence</th><th style={thC()}>Aggregate</th>
              </tr>
            </thead>
            <tbody>
              {coverages.map((c, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...tdC(), fontWeight: 600, color: C.txt }}>{c.type}</td>
                  <td style={tdC()}>{c.policy_number || '—'}</td>
                  <td style={tdC()}>{c.effective_date || '—'}</td>
                  <td style={tdC()}>{c.expiration_date || '—'}</td>
                  <td style={tdC()}>{c.each_occurrence_limit || '—'}</td>
                  <td style={tdC()}>{c.aggregate_limit || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Additional terms</h3>
        {coi.additional_terms?.trim() ? (
          <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>{coi.additional_terms}</p>
        ) : (
          <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>None stated on the certificate.</p>
        )}
      </div>
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

const cardC = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 })
const h2C = () => ({ fontSize: 13, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 10px' })
const thC = () => ({ padding: '8px 10px 8px 0', fontWeight: 600 as const })
const tdC = () => ({ padding: '9px 10px 9px 0', color: C.txt2 })
