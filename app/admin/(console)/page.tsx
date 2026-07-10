import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'
import { deriveAdminStatus, adminStatusColor } from '@/lib/admin-status'
import { pacificDateTime } from '@/lib/dates'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  display_id: string
  carrier_name: string
  status: string
  source: string
  created_at: string
  published_at: string | null
  case_status: string | null
  coi_extracted: unknown
  call_notes: unknown
  manual_notes: string | null
  insurance_contact: unknown
  final_report: unknown
  orgs: { name: string } | null
}

export default async function AdminQueue() {
  await requireAdmin()
  // Service client: column-level grants on verifications block parts of the table
  // for the `authenticated` role, and a query error here must not render as an
  // empty queue. Row access is safe: requireAdmin above.
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('verifications')
    .select('id, display_id, carrier_name, status, source, created_at, published_at, case_status, coi_extracted, call_notes, manual_notes, insurance_contact, final_report, orgs(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Could not load the review queue: ${error.message}`)

  const all = (data ?? []) as unknown as Row[]
  // Rejected requests are done from the admin's perspective even though
  // nothing was published — they live in Completed, not the review queue.
  const done = (r: Row) => !!r.published_at || r.case_status === 'rejected'
  const open = all.filter(r => !done(r))
  const completed = all.filter(done)

  return (
    <div>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, color: C.txt, margin: 0, fontWeight: 400 }}>Review queue</h1>
      <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14, margin: '4px 0 24px' }}>
        {open.length === 0 ? 'No verifications awaiting review.' : `${open.length} awaiting review`}
        {' · '}{all.length} total
      </p>

      {open.length > 0 && <VerificationTable rows={open} />}

      {completed.length > 0 && (
        <>
          <h2 style={{ fontFamily: C.serif, fontSize: 20, color: C.txt, margin: '36px 0 12px', fontWeight: 400 }}>
            Completed
          </h2>
          <VerificationTable rows={completed} showPublished />
        </>
      )}
    </div>
  )
}

function VerificationTable({ rows, showPublished }: { rows: Row[]; showPublished?: boolean }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.sans, fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <th style={th()}>ID</th><th style={th()}>Org</th><th style={th()}>Carrier</th><th style={th()}>Source</th><th style={th()}>Status</th>
            <th style={th()}>{showPublished ? 'Published' : 'Submitted'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={td()}>
                <Link href={`/admin/${r.id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>{r.display_id}</Link>
              </td>
              <td style={td()}>{r.orgs?.name ?? '—'}</td>
              <td style={td()}>{r.carrier_name}</td>
              <td style={{ ...td(), color: C.txt3, textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px' }}>{r.source}</td>
              <td style={td()}>
                <AdminStatusPill row={r} />
              </td>
              <td style={{ ...td(), color: C.txt3 }}>
                {pacificDateTime(showPublished && r.published_at ? r.published_at : r.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminStatusPill({ row }: { row: Row }) {
  const s = deriveAdminStatus(row)
  const color = adminStatusColor(s)
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '3px 9px', borderRadius: 20 }}>{s}</span>
  )
}

const th = () => ({ padding: '12px 16px', fontWeight: 600 as const })
const td = () => ({ padding: '13px 16px', color: C.txt })
