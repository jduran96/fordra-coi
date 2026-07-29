import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'
import BusinessesTable from '@/components/BusinessesTable'
import { buildBusinessRows, type BusinessSourceRow } from '@/lib/businesses'
import type { FeedEventRow } from '@/lib/activity-feed'

export const dynamic = 'force-dynamic'

/**
 * The org's insured businesses: verifications grouped by insured legal entity
 * (name + address), with a coverage rollup per entity. The publish-gated
 * report columns come back null for pending rows through my_verifications,
 * which is exactly the "ignore unpublished" rule coverageStatus applies.
 */
export default async function CustomerBusinesses() {
  const profile = await getProfile()
  const supabase = await createClient()

  if (!profile?.org_id) {
    return (
      <div style={card()}>
        <h1 style={h1()}>Businesses</h1>
        <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14, lineHeight: 1.6 }}>
          Please contact a Fordra admin to set up your account.
        </p>
      </div>
    )
  }

  const { data: rows, error } = await supabase
    .from('my_verifications')
    .select('id, display_id, insured_name, insured_address, status, case_status, created_at, published_at, final_report, gap_analysis')
    .order('created_at', { ascending: false })
  // Fail loudly: an empty roster on a failed read lies.
  if (error) throw new Error(`Could not load businesses: ${error.message}`)

  const source = (rows ?? []) as BusinessSourceRow[]
  const ids = source.map(r => r.id)
  const eventsByVerification = new Map<string, FeedEventRow[]>()
  if (ids.length) {
    // RLS scopes events to the org; a feed read failure only costs the
    // Activity popups, never the roster itself.
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

  const businesses = buildBusinessRows(source, eventsByVerification, '/app')

  return (
    <div style={{ fontFamily: C.sans, color: C.txt }}>
      <h1 style={h1()}>Businesses</h1>
      <p style={{ color: C.txt3, fontSize: 13, margin: '0 0 20px' }}>
        Every insured business you have checked, with its verification history and current coverage standing.
      </p>
      {businesses.length === 0 ? (
        <div style={card()}>
          <p style={{ color: C.txt2, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            No businesses yet. Businesses appear once a certificate has been processed.
          </p>
        </div>
      ) : (
        <BusinessesTable rows={businesses} basePath="/app" />
      )}
    </div>
  )
}

const h1 = () => ({ fontFamily: C.serif, fontSize: 28, fontWeight: 400 as const, color: C.txt, margin: '0 0 6px' })
const card = () => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 })
