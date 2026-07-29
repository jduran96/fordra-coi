import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { C } from '@/lib/theme'
import { deriveAdminStatus, adminStatusColor } from '@/lib/admin-status'
import { adminInitials } from '@/lib/admin-activity'
import PaginatedTable from '@/components/PaginatedTable'
import { pacificDateTimeParts } from '@/lib/dates'
import { caseAge, ageTitle, turnaroundLabel } from '@/lib/sla'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  display_id: string
  insured_name: string
  status: string
  source: string
  created_at: string
  updated_at: string | null
  published_at: string | null
  case_status: string | null
  coi_extracted: unknown
  call_notes: unknown
  manual_notes: string | null
  insurance_contact: unknown
  final_report: unknown
  assigned_admin: string | null
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
    .select('id, display_id, insured_name, status, source, created_at, updated_at, published_at, case_status, coi_extracted, call_notes, manual_notes, insurance_contact, final_report, assigned_admin, orgs(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Could not load the review queue: ${error.message}`)

  const all = (data ?? []) as unknown as Row[]
  // Failed requests are done from the admin's perspective even though
  // nothing was published — they live in Completed, not the review queue.
  const done = (r: Row) => !!r.published_at || r.case_status === 'failed'
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
    <PaginatedTable
      pageSize={10}
      head={
        <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          <th style={th()}>ID</th><th style={th()}>Org</th><th style={th()}>Policyholder</th><th style={th()}>Source</th><th style={th()}>Status</th><th style={th()}>Admin</th>
          <th style={th()}>{showPublished ? 'Published' : 'Submitted'}</th>
        </tr>
      }
      rows={rows.map(r => (
        <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
          <td style={td()}>
            <Link href={`/admin/${r.id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>{r.display_id}</Link>
          </td>
          {/* Long org/carrier names truncate so Status/Admin never get squeezed
              off; the full value is on hover. */}
          <td style={{ ...td(), ...clip() }} title={r.orgs?.name ?? undefined}>{r.orgs?.name ?? '—'}</td>
          <td style={{ ...td(), ...clip() }} title={r.insured_name}>{r.insured_name || r.display_id}</td>
          <td style={{ ...td(), color: C.txt3, textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.5px' }}>{r.source}</td>
          <td style={td()}>
            <AdminStatusPill row={r} />
          </td>
          <td style={td()}>
            <AssignedPill row={r} />
          </td>
          <td style={{ ...td(), color: C.txt3 }}>
            {showPublished
              ? <Timestamp iso={r.published_at ?? r.updated_at ?? r.created_at} sub={turnaroundLabel(r.created_at, r.published_at ?? r.updated_at)} />
              : <Timestamp iso={r.created_at} />}
          </td>
        </tr>
      ))}
      cards={rows.map(r => {
        const { dateTime } = pacificDateTimeParts(showPublished ? (r.published_at ?? r.updated_at ?? r.created_at) : r.created_at)
        return (
          <Link key={r.id} href={`/admin/${r.id}`} style={{
            display: 'block', padding: '14px 14px', borderTop: `1px solid ${C.border}`,
            textDecoration: 'none', color: C.txt,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: C.mono, fontSize: 12.5, fontWeight: 600, color: C.txt2 }}>{r.display_id}</span>
              <span style={{ marginLeft: 'auto' }}>
                {showPublished
                  ? <span style={{ fontSize: 12, color: C.txt3 }}>{turnaroundLabel(r.created_at, r.published_at ?? r.updated_at) ?? ''}</span>
                  : <AgePill iso={r.created_at} />}
              </span>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 600, margin: '5px 0 2px', lineHeight: 1.3 }}>
              {r.insured_name || r.display_id}
            </div>
            <div style={{ fontSize: 12.5, color: C.txt3 }}>
              {r.orgs?.name ?? '—'} · {r.source.toUpperCase()} · {dateTime}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <AdminStatusPill row={r} />
              <AssignedPill row={r} />
            </div>
          </Link>
        )
      })}
    />
  )
}

function AdminStatusPill({ row }: { row: Row }) {
  const s = deriveAdminStatus(row)
  const color = adminStatusColor(s)
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{s}</span>
  )
}

/**
 * Working-day age of an open case against the same-day target: green today,
 * amber at 1-2 days, red from 3. Weekends do not count (a Friday submission
 * read on Monday is one day old, not three).
 */
function AgePill({ iso }: { iso: string }) {
  const age = caseAge(iso)
  return (
    <span title={ageTitle(age)} style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.03em',
      color: age.color, background: `color-mix(in oklch, ${age.color} 13%, transparent)`,
      padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap',
    }}>
      {age.label}
    </span>
  )
}

/** The admin the deal is assigned to (Assign button on the detail page). */
function AssignedPill({ row }: { row: Row }) {
  const email = (row.assigned_admin ?? '').trim()
  if (!email) return <span style={{ color: C.txt3 }}>—</span>
  return (
    <span title={`Assigned to ${email}`} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: C.txt2, background: `color-mix(in oklch, ${C.txt2} 10%, transparent)`, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{adminInitials(email)}</span>
  )
}

/** Date + time on one line, timezone (or a caller-supplied note) underneath. */
function Timestamp({ iso, sub }: { iso: string; sub?: string | null }) {
  const { dateTime, tz } = pacificDateTimeParts(iso)
  return (
    <>
      <div style={{ whiteSpace: 'nowrap' }}>{dateTime}</div>
      <div style={{ fontSize: 12, color: C.txt3 }}>{sub ?? tz}</div>
    </>
  )
}

const th = () => ({
  padding: '12px 16px', fontWeight: 600 as const, whiteSpace: 'nowrap' as const,
  position: 'sticky' as const, top: 0, background: C.surface, zIndex: 1,
})
const td = () => ({ padding: '13px 16px', color: C.txt })
const clip = () => ({
  maxWidth: 160, whiteSpace: 'nowrap' as const,
  overflow: 'hidden' as const, textOverflow: 'ellipsis' as const,
})
