'use client'

import { useState } from 'react'
import Link from 'next/link'
import { C, statusColor, statusLabel } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
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
  verified:  { label: 'Verified',  color: C.ok as string },
  uncertain: { label: 'Uncertain', color: C.warn as string },
  failed:    { label: 'Failed',    color: C.error as string },
} as const

const PAGE_SIZE = 25

/**
 * The Businesses roster: one row per insured entity, expandable to a table of
 * its verifications, each linking straight to the full report. Expansion
 * state needs a client component, so this owns its rows outright instead of
 * composing PaginatedTable; the pager copies that component's behavior
 * (client-side slicing is right for pilot-scale data, same caveat as
 * PaginatedTable).
 */
export default function BusinessesTable({ rows, basePath }: {
  rows: BusinessRow[]
  basePath: '/app' | '/admin'
}) {
  const [page, setPage] = useState(0)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
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
                        <thead>
                          <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            <th style={{ ...dth(), paddingLeft: 0 }}>Verification</th>
                            <th style={dth()}>Status</th>
                            <th style={dth()}>Checks</th>
                            <th style={{ ...dth(), textAlign: 'right', paddingRight: 0 }}>Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.verifications.map(v => {
                            const display = v.case_status === 'failed' ? 'failed' : v.status
                            return (
                              <tr key={v.id} style={{ borderTop: `1px solid ${C.border}` }}>
                                <td style={{ ...dtd(), paddingLeft: 0 }}>
                                  <Link href={`${basePath}/${v.id}`} style={{
                                    color: C.txt, fontWeight: 600, fontSize: 13.5, fontFamily: C.sans,
                                    textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3,
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {v.display_id}
                                  </Link>
                                </td>
                                <td style={dtd()}>
                                  <span style={{
                                    fontSize: 12, fontWeight: 600, color: statusColor(display), whiteSpace: 'nowrap',
                                    background: `color-mix(in oklch, ${statusColor(display)} 12%, transparent)`,
                                    padding: '2px 9px', borderRadius: 20,
                                  }}>
                                    {statusLabel(display)}
                                  </span>
                                </td>
                                <td style={dtd()}>
                                  {v.counts ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                      {checkParts(v.counts).map(p => (
                                        <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.txt, whiteSpace: 'nowrap' }}>
                                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
                                          {p.n} {p.label}
                                        </span>
                                      ))}
                                    </span>
                                  ) : (
                                    <span style={{ color: C.txt3 }}>No report</span>
                                  )}
                                </td>
                                <td style={{ ...dtd(), paddingRight: 0, color: C.txt3, whiteSpace: 'nowrap', textAlign: 'right' }}>
                                  {pacificDateTime(v.created_at)}
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
    </div>
  )
}

/** Verdict-count dots for a published report, worst color when nonzero. */
const checkParts = (c: { met: number; not_met: number; uncertain: number }) => [
  { n: c.met, label: 'passed', color: C.ok as string },
  { n: c.not_met, label: 'failed', color: c.not_met === 0 ? C.ok as string : C.error as string },
  { n: c.uncertain, label: c.uncertain === 1 ? 'warning' : 'warnings', color: c.uncertain === 0 ? C.ok as string : C.warn as string },
]

const th = () => ({ padding: '11px 14px', whiteSpace: 'nowrap' as const })
const dth = () => ({ padding: '9px 10px 5px', whiteSpace: 'nowrap' as const, fontWeight: 600 as const })
const dtd = () => ({ padding: '7px 10px', verticalAlign: 'middle' as const })
const td = () => ({ padding: '11px 14px', verticalAlign: 'middle' as const })
const pagerBtn = (disabled: boolean) => ({
  width: 26, height: 26, padding: 0, fontSize: 14, lineHeight: 1, fontFamily: C.sans,
  color: C.txt2, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
})
