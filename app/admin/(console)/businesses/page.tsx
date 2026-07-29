import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'
import BusinessesTable from '@/components/BusinessesTable'
import { buildBusinessRows, type BusinessSourceRow } from '@/lib/businesses'
import type { FeedEventRow } from '@/lib/activity-feed'

export const dynamic = 'force-dynamic'

/**
 * Every insured business across ALL orgs, grouped by legal entity (name +
 * address). Service client after requireAdmin: column-level grants on
 * verifications make select('*')-style reads fail on the session client.
 */
export default async function AdminBusinesses() {
  await requireAdmin()
  const supabase = createServiceClient()

  const { data: rows, error } = await supabase
    .from('verifications')
    .select('id, display_id, insured_name, insured_address, status, case_status, created_at, published_at, final_report, gap_analysis, orgs(name)')
    .order('created_at', { ascending: false })
  // Fail loudly: an empty roster on a failed read lies.
  if (error) throw new Error(`Could not load businesses: ${error.message}`)

  const source: BusinessSourceRow[] = (rows ?? []).map(r => ({
    ...(r as unknown as BusinessSourceRow),
    orgName: (r as { orgs?: { name?: string } | null }).orgs?.name ?? undefined,
  }))
  const ids = source.map(r => r.id)
  const eventsByVerification = new Map<string, FeedEventRow[]>()
  if (ids.length) {
    const { data: events } = await supabase
      .from('events')
      .select('type, created_at, verification_id')
      .in('verification_id', ids)
      .order('created_at', { ascending: false })
    for (const e of events ?? []) {
      const vid = e.verification_id as string
      eventsByVerification.set(vid, [...(eventsByVerification.get(vid) ?? []), e])
    }
  }

  const businesses = buildBusinessRows(source, eventsByVerification, '/admin')

  return (
    <div style={{ fontFamily: C.sans, color: C.txt }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 26, fontWeight: 400, color: C.txt, margin: '0 0 6px' }}>Businesses</h1>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 20px' }}>
        Every insured business checked across all orgs, with verification history and coverage standing.
      </p>
      {businesses.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
          <p style={{ color: C.txt2, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            No businesses yet. Businesses appear once a certificate has been processed.
          </p>
        </div>
      ) : (
        <BusinessesTable rows={businesses} basePath="/admin" />
      )}
    </div>
  )
}
