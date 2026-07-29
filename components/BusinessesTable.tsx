'use client'

import { useState } from 'react'
import Link from 'next/link'
import { C, statusColor, statusLabel } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import EditorModal from '@/components/EditorModal'
import ActivityFeed from '@/components/ActivityFeed'
import { mergeFeeds, type FeedEntry } from '@/lib/activity-feed'
import type { CoverageStatus } from '@/lib/businesses'

export interface BusinessVerificationRow {
  id: string
  display_id: string
  status: string
  case_status: string | null
  created_at: string
  published_at: string | null
  /** Verdict counts from the published report; null while unpublished. */
  counts: { met: number; not_met: number; uncertain: number } | null
  feed: FeedEntry[]
}

export interface BusinessRow {
  key: string
  name: string
  address: string
  /** Present only on the admin table (all orgs); renders the Org column. */
  orgName?: string
  coverage: CoverageStatus
  verifications: BusinessVerificationRow[]
}

const COVERAGE = {
  active:    { label: 'Active',    color: C.ok as string },
  uncertain: { label: 'Uncertain', color: C.warn as string },
  lapsed:    { label: 'Lapsed',    color: C.error as string },
} as const

const PAGE_SIZE = 25

/**
 * The Businesses roster: one row per insured entity, expandable to its
 * verifications; a verification opens a summary dialog linking to the full
 * report. Expansion and dialog state need a client component, so this owns
 * its rows outright instead of composing PaginatedTable; the pager copies
 * that component's behavior (client-side slicing is right for pilot-scale
 * data, same caveat as PaginatedTable).
 */
export default function BusinessesTable({ rows, basePath }: {
  rows: BusinessRow[]
  basePath: '/app' | '/admin'
}) {
  const [page, setPage] = useState(0)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<BusinessVerificationRow | null>(null)
  const showOrg = rows.some(r => r.orgName)

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const cur = Math.min(page, pages - 1)
  const pageRows = rows.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)
  // Expand + Legal entity + Address + Verifications + Coverage + Activity,
  // plus the conditional Org column. An off-by-one here shrinks the expanded
  // detail row and misaligns/clips its content (owner report 2026-07-29).
  const cols = 6 + (showOrg ? 1 : 0)

  const toggle = (key: string) => setOpenKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.sans, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={{ ...th(), width: 34 }} aria-label="Expand" />
              <th style={th()}>Legal entity</th>
              <th style={th()}>Address</th>
              {showOrg && <th style={th()}>Org</th>}
              <th style={th()}>Verifications</th>
              <th style={th()}>Coverage</th>
              <th style={{ ...th(), textAlign: 'right' }} aria-label="Activity" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map(b => {
              const open = openKeys.has(b.key)
              const cov = COVERAGE[b.coverage]
              return [
                <tr key={b.key} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td()}>
                    <button type="button" onClick={() => toggle(b.key)}
                      aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}
                      style={{
                        width: 26, height: 26, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: 'transparent', color: C.txt2, cursor: 'pointer', fontSize: 12, lineHeight: 1,
                      }}>
                      <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
                    </button>
                  </td>
                  <td style={{ ...td(), fontWeight: 600 }}>{b.name}</td>
                  <td style={{ ...td(), color: C.txt2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.address || undefined}>
                    {b.address || '—'}
                  </td>
                  {showOrg && <td style={{ ...td(), color: C.txt2 }}>{b.orgName ?? '—'}</td>}
                  <td style={td()}>{b.verifications.length}</td>
                  <td style={td()}>
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: cov.color, whiteSpace: 'nowrap',
                      background: `color-mix(in oklch, ${cov.color} 12%, transparent)`,
                      padding: '3px 10px', borderRadius: 20,
                    }}>
                      {cov.label}
                    </span>
                  </td>
                  <td style={{ ...td(), textAlign: 'right' }}>
                    <ActivityFeed entries={mergeFeeds(b.verifications.map(v => v.feed))} title={b.name} />
                  </td>
                </tr>,
                open && (
                  <tr key={`${b.key}-detail`}>
                    <td colSpan={cols} style={{ padding: '4px 14px 14px 48px', background: C.paper }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                        <tbody>
                          {b.verifications.map(v => {
                            const display = v.case_status === 'failed' ? 'failed' : v.status
                            // One cell for id + status so the tag always sits
                            // right next to the link (the old three-column
                            // auto layout stretched the id column apart from
                            // it), date right-aligned.
                            return (
                              <tr key={v.id} style={{ borderTop: `1px solid ${C.border}` }}>
                                <td style={{ padding: '8px 10px 8px 0' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                                    <button type="button" onClick={() => setSelected(v)} style={{
                                      padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                                      color: C.txt, fontWeight: 600, fontSize: 13.5, fontFamily: C.sans,
                                      textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3,
                                    }}>
                                      {v.display_id}
                                    </button>
                                    <span style={{
                                      fontSize: 12, fontWeight: 600, color: statusColor(display), whiteSpace: 'nowrap',
                                      background: `color-mix(in oklch, ${statusColor(display)} 12%, transparent)`,
                                      padding: '2px 9px', borderRadius: 20,
                                    }}>
                                      {statusLabel(display)}
                                    </span>
                                  </span>
                                </td>
                                <td style={{ padding: '8px 0 8px 10px', color: C.txt3, whiteSpace: 'nowrap', textAlign: 'right' }}>
                                  submitted {pacificDateTime(v.created_at)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
          padding: '9px 14px', borderTop: `1px solid ${C.border}`, fontFamily: C.sans,
        }}>
          <button type="button" aria-label="Previous page" disabled={cur === 0}
            onClick={() => setPage(cur - 1)} style={pagerBtn(cur === 0)}>‹</button>
          <span style={{ fontSize: 12, color: C.txt3 }}>Page {cur + 1} of {pages}</span>
          <button type="button" aria-label="Next page" disabled={cur >= pages - 1}
            onClick={() => setPage(cur + 1)} style={pagerBtn(cur >= pages - 1)}>›</button>
        </div>
      )}
      {selected && <ReportSummaryModal v={selected} basePath={basePath} onClose={() => setSelected(null)} />}
    </div>
  )
}

/**
 * Lightweight report summary (owner chose this over embedding the full
 * report): verdict counts, status, dates, and the link out to the real page.
 */
function ReportSummaryModal({ v, basePath, onClose }: {
  v: BusinessVerificationRow
  basePath: '/app' | '/admin'
  onClose: () => void
}) {
  const display = v.case_status === 'failed' ? 'failed' : v.status
  const c = v.counts
  const total = c ? c.met + c.not_met + c.uncertain : 0
  const parts = c ? [
    { n: c.met, label: 'passed', color: C.ok as string },
    { n: c.not_met, label: 'failed', color: c.not_met === 0 ? C.ok as string : C.error as string },
    { n: c.uncertain, label: c.uncertain === 1 ? 'warning' : 'warnings', color: c.uncertain === 0 ? C.ok as string : C.warn as string },
  ] : []
  return (
    <EditorModal title={v.display_id} onClose={onClose} maxWidth={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
        <div>
          <span style={{
            fontSize: 12, fontWeight: 600, color: statusColor(display),
            background: `color-mix(in oklch, ${statusColor(display)} 12%, transparent)`,
            padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap',
          }}>
            {statusLabel(display)}
          </span>
        </div>
        {c ? (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: C.txt }}>{total} {total === 1 ? 'check' : 'checks'}</span>
            {parts.map(p => (
              <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 600, color: C.txt }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
                {p.n} {p.label}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13.5, color: C.txt3, margin: 0 }}>No published report yet.</p>
        )}
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 7 }}>
          <dt style={{ fontSize: 13, color: C.txt3 }}>Submitted</dt>
          <dd style={{ margin: 0, fontSize: 13.5, color: C.txt }}>{pacificDateTime(v.created_at)}</dd>
          <dt style={{ fontSize: 13, color: C.txt3 }}>Published</dt>
          <dd style={{ margin: 0, fontSize: 13.5, color: C.txt }}>{v.published_at ? pacificDateTime(v.published_at) : 'Not published'}</dd>
        </dl>
        <div>
          <Link href={`${basePath}/${v.id}`} style={{
            display: 'inline-block', padding: '8px 18px', fontSize: 13, fontWeight: 600,
            borderRadius: 9999, border: `1px solid ${C.border}`, color: C.txt2,
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            Open full report
          </Link>
        </div>
      </div>
    </EditorModal>
  )
}

const th = () => ({ padding: '11px 14px', whiteSpace: 'nowrap' as const })
const td = () => ({ padding: '11px 14px', verticalAlign: 'middle' as const })
const pagerBtn = (disabled: boolean) => ({
  width: 26, height: 26, padding: 0, fontSize: 14, lineHeight: 1, fontFamily: C.sans,
  color: C.txt2, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
})
