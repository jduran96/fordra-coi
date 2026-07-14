import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { signedUrl } from '@/lib/storage'
import { C, statusColor } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import CoiSplitReview from '@/components/CoiSplitReview'
import { parseStandardLine } from '@/lib/templates'
import type { COIExtracted } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface GapItem {
  requirement: { coverage_type?: string; minimum_limit?: string; notes?: string | null }
  status: 'met' | 'not_met' | 'uncertain'
  evidence?: string
}
interface Gap { met?: GapItem[]; not_met?: GapItem[]; uncertain?: GapItem[] }
interface CallNote { at: string; text: string; contact?: { name?: string; phone?: string; email?: string } }

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
    // 22P02: the id is not a valid uuid (mistyped URL), a 404 not a failure.
    if (error && error.code !== '22P02') throw new Error('Could not load this verification. Please retry.')
    notFound()
  }

  // Original submission (source of truth for the customer): RLS scopes this to their org.
  const { data: docs, error: docsErr } = await supabase
    .from('documents')
    .select('id, kind, file_name, storage_path, mime_type')
    .eq('verification_id', id)
  // "Not submitted" on a failed read lies about documents that exist.
  if (docsErr) throw new Error(`Could not load documents: ${docsErr.message}`)
  const docsWithUrls = await Promise.all(
    (docs ?? []).map(async d => ({ ...d, url: await signedUrl(d.storage_path).catch(() => null) })),
  )
  // The submitted certificate itself, rendered in the split review.
  const coiFile = docsWithUrls.find(d => d.kind === 'coi' && d.url)
  const coiDoc = coiFile ? { url: coiFile.url!, mime: coiFile.mime_type ?? '', fileName: coiFile.file_name } : null
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
  const coi = (v.coi_extracted ?? null) as COIExtracted | null
  // The customer always sees one format, whichever produced the verdicts:
  // the admin's reviewed final_report wins; the automated gap analysis is the fallback.
  const finalItems = gapItems(report)
  const items: GapItem[] = finalItems.length ? finalItems : gapItems((v.gap_analysis ?? null) as Gap | null)

  const displayStatus = rejected ? 'rejected' : v.status

  // The published split-review layout (certificate + checks side by side)
  // needs the full 980px the /app shell allows; the waiting/rejected notices
  // keep the narrow reading column.
  const showReport = published && !rejected
  return (
    <div style={{ maxWidth: showReport ? undefined : 760, fontFamily: C.sans, color: C.txt }}>
      <style>{`@media print {
        header, .no-print { display: none !important; }
        body { background: #fff !important; }
      }`}</style>
      <Link href="/app" className="no-print" style={{ color: C.txt2, fontSize: 14, textDecoration: 'none' }}>← Verifications</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 4px' }}>
        <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: 0, fontWeight: 400 }}>{v.carrier_name}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(displayStatus), background: `${statusColor(displayStatus)}1a`, padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize' }}>{displayStatus}</span>
        {published && !rejected && (
          <a href={`/app/${id}/pdf`} className="no-print" style={{
            marginLeft: 'auto', padding: '8px 18px', fontSize: 13, fontWeight: 600,
            fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`,
            color: C.txt2, textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            Download PDF
          </a>
        )}
      </div>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 24px' }}>{v.display_id} · submitted {pacificDateTime(v.created_at)}</p>

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

          {items.length > 0 && <VerdictStrip items={items} />}

          {/* Reading order (design-partner request, 2026-07-14): the checks
              laid over the certificate, then the calls that resolved them,
              then the submitted documents as the record. */}
          <CoiSplitReview coi={coi} items={items} doc={coiDoc} />
          <CallNotesCard notes={(Array.isArray(v.call_notes) ? v.call_notes : []) as CallNote[]} />
          <SubmittedCard docs={docsWithUrls} requirementsText={requirementsText} templateName={templateName} />
        </div>
      )}
    </div>
  )
}

/**
 * Calls made to the insurer during review, newest first. Stacked entries, not a
 * table: transcripts can run long, so the text gets the card's full width and
 * nothing is clamped or scrolled — the whole thing prints.
 */
function CallNotesCard({ notes }: { notes: CallNote[] }) {
  return (
    <div style={cardC()}>
      <h2 style={h2C()}>Insurer call notes</h2>
      {notes.length === 0 ? (
        <p style={{ fontSize: 13.5, color: C.txt3, margin: 0 }}>No calls made.</p>
      ) : (
        notes.slice().reverse().map((n, i) => {
          const who = [n.contact?.name, n.contact?.phone, n.contact?.email]
            .map(s => s?.trim()).filter(Boolean).join(' · ')
          return (
            <div key={i} style={{
              padding: '14px 0',
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}>
              <p style={{ fontSize: 12.5, margin: '0 0 6px' }}>
                <span style={{ fontWeight: 600, color: C.txt }}>{pacificDateTime(n.at)}</span>
                {who && <span style={{ color: C.txt3 }}> · {who}</span>}
              </p>
              <p style={{ fontSize: 13.5, color: C.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.65, margin: 0 }}>{n.text}</p>
            </div>
          )
        })
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
    ['Other documents', byKind('rcs')],
    ['Insurance standards', byKind('requirements')],
  ]
  // How the standards arrived, shown when no standards file was uploaded.
  const standardsFallback = templateName
    ? `Used template: ${templateName}`
    : requirementsText ? 'Entered manually' : 'Not submitted'
  const fallbackFor = (label: string) =>
    label === 'Insurance standards' ? standardsFallback
    : label === 'Other documents' ? 'N/A'
    : 'Not submitted'
  return (
    <div style={cardC()}>
      <h2 style={h2C()}>What you submitted</h2>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 20, rowGap: 8 }}>
        {rows.map(([label, files]) => (
          <SubmittedRow key={label} label={label} files={files} fallback={fallbackFor(label)} />
        ))}
      </dl>
      {requirementsText && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px' }}>Insurance standards</h3>
          {/* One numbered item per standards line, same readable render the
              admin detail page uses (bold title, bold limit, notes below). */}
          <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requirementsText.split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
              const r = parseStandardLine(line)
              return (
                <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: C.txt }}>
                  <span style={{ fontWeight: 700 }}>{r.title}</span>
                  {r.limit ? <span style={{ fontWeight: 600 }}>{`: ${r.limit}`}</span> : null}
                  {r.notes ? <div style={{ fontSize: 13, color: C.txt2, marginTop: 3, lineHeight: 1.6 }}>{r.notes}</div> : null}
                </li>
              )
            })}
          </ol>
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

/**
 * One-line verdict counts above the split review. Same numbers the old stat
 * tiles showed (checks / discrepancies / unconfirmed), plus satisfied.
 */
function VerdictStrip({ items }: { items: GapItem[] }) {
  const met = items.filter(i => i.status === 'met').length
  const disc = items.filter(i => i.status === 'not_met').length
  const miss = items.filter(i => i.status === 'uncertain').length
  const parts = [
    { n: items.length, label: items.length === 1 ? 'check' : 'checks', color: C.txt },
    { n: met, label: 'satisfied', color: C.ok },
    { n: disc, label: disc === 1 ? 'discrepancy' : 'discrepancies', color: disc === 0 ? C.ok : C.error },
    { n: miss, label: 'unconfirmed', color: miss === 0 ? C.ok : C.warn },
  ]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: '12px 18px',
      background: C.cream, border: `1px solid ${C.border}`, borderRadius: 12,
    }}>
      {parts.map(p => (
        <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 600, color: C.txt }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          {p.n} {p.label}
        </span>
      ))}
    </div>
  )
}

const cardC = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 })
const h2C = () => ({ fontSize: 13, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 10px' })
