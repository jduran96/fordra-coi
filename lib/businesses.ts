/**
 * Grouping and coverage rollup for the Businesses pages: one business = one
 * insured legal entity (normalized name + address). Pure helpers shared by
 * /app/businesses (session client, org-scoped) and /admin/businesses
 * (service client, all orgs).
 */

import { feedEntries, type FeedEventRow } from '@/lib/activity-feed'
import type { BusinessRow } from '@/components/BusinessesTable'

export type CoverageStatus = 'active' | 'uncertain' | 'lapsed'

interface ReportBuckets { met?: unknown[]; not_met?: unknown[]; uncertain?: unknown[] }

export interface GroupableRow {
  insured_name: string | null
  insured_address: string | null
  published_at: string | null
  final_report?: ReportBuckets | null
  gap_analysis?: ReportBuckets | null
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const bucketCount = (r: ReportBuckets | null | undefined) =>
  r ? (r.met?.length ?? 0) + (r.not_met?.length ?? 0) + (r.uncertain?.length ?? 0) : 0

/**
 * Coverage rollup across a business's verifications, published reports only
 * (pending rows carry no verdicts and are ignored by owner decision
 * 2026-07-28): any failed check anywhere = lapsed; else any warning =
 * uncertain; all green = active. Zero published reports = uncertain.
 * Per row the admin's final_report outranks the automated gap_analysis,
 * matching the report page and PDF.
 */
export function coverageStatus(rows: GroupableRow[]): CoverageStatus {
  const published = rows.filter(r => r.published_at)
  if (!published.length) return 'uncertain'
  let sawWarning = false
  for (const r of published) {
    const rep = (r.final_report && bucketCount(r.final_report) ? r.final_report : r.gap_analysis) ?? null
    if (!rep || !bucketCount(rep)) { sawWarning = true; continue }
    if ((rep.not_met?.length ?? 0) > 0) return 'lapsed'
    if ((rep.uncertain?.length ?? 0) > 0) sawWarning = true
  }
  return sawWarning ? 'uncertain' : 'active'
}

/**
 * Group verifications into businesses by normalized name + address. Rows with
 * a blank insured_name (not yet extracted) have no business identity and are
 * excluded — they still appear on the verifications list. Input order is
 * preserved within and across groups, so callers passing rows newest-first
 * get businesses ranked by most recent activity.
 */
export function groupBusinesses<T extends GroupableRow>(rows: T[]): {
  key: string
  name: string
  address: string
  rows: T[]
}[] {
  const groups = new Map<string, { key: string; name: string; address: string; rows: T[] }>()
  for (const r of rows) {
    if (!norm(r.insured_name)) continue
    const key = `${norm(r.insured_name)}|${norm(r.insured_address)}`
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else groups.set(key, { key, name: (r.insured_name ?? '').trim(), address: (r.insured_address ?? '').trim(), rows: [r] })
  }
  return [...groups.values()]
}

export interface BusinessSourceRow extends GroupableRow {
  id: string
  display_id: string
  status: string
  case_status: string | null
  created_at: string
  /** Admin page only: the owning org's name. */
  orgName?: string
}

/**
 * Serialize DB rows + their events into what BusinessesTable renders. Verdict
 * counts come from the published report (final_report over gap_analysis, like
 * everywhere else); unpublished rows get null counts and render "no report".
 */
export function buildBusinessRows(
  rows: BusinessSourceRow[],
  eventsByVerification: Map<string, FeedEventRow[]>,
): BusinessRow[] {
  const countsFor = (r: BusinessSourceRow) => {
    if (!r.published_at) return null
    const rep = (r.final_report && bucketCount(r.final_report) ? r.final_report : r.gap_analysis) ?? null
    if (!rep || !bucketCount(rep)) return null
    return { met: rep.met?.length ?? 0, not_met: rep.not_met?.length ?? 0, uncertain: rep.uncertain?.length ?? 0 }
  }
  return groupBusinesses(rows).map(g => ({
    key: g.key,
    name: g.name,
    address: g.address,
    ...(g.rows[0].orgName ? { orgName: g.rows[0].orgName } : {}),
    coverage: coverageStatus(g.rows),
    verifications: g.rows.map(r => ({
      id: r.id,
      display_id: r.display_id,
      status: r.status,
      case_status: r.case_status,
      created_at: r.created_at,
      published_at: r.published_at,
      counts: countsFor(r),
      feed: feedEntries({ created_at: r.created_at, display_id: r.display_id }, eventsByVerification.get(r.id) ?? [], r.display_id),
    })),
  }))
}
