import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth-helpers'
import { C, statusColor } from '@/lib/theme'
import { pacificDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function PortalDashboard() {
  const profile = await getProfile()
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('my_verifications')
    .select('id, display_id, carrier_name, status, case_status, source, created_at, published_at')
    .order('created_at', { ascending: false })

  if (!profile?.org_id) {
    return (
      <div style={card()}>
        <h1 style={h1()}>Welcome!</h1>
        <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14, lineHeight: 1.6 }}>
          Please contact a Fordra admin to set up your account.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={h1()}>Verifications</h1>
        <Link href="/app/new" style={primaryLink()}>+ New verification</Link>
      </div>

      {!rows?.length ? (
        <div style={card()}>
          <p style={{ color: C.txt2, fontFamily: C.sans, fontSize: 14 }}>
            No verifications yet. <Link href="/app/new" style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>Submit your first one →</Link>
          </p>
        </div>
      ) : (
        <div style={card(0)}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.sans, fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={th()}>ID</th><th style={th()}>Carrier</th><th style={th()}>Status</th><th style={th()}>Source</th><th style={th()}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td()}><Link href={`/app/${r.id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>{r.display_id}</Link></td>
                  <td style={td()}>{r.carrier_name}</td>
                  <td style={td()}><Pill status={r.case_status === 'rejected' ? 'rejected' : r.status} /></td>
                  <td style={{ ...td(), color: C.txt3 }}>{sourceLabel(r.source)}</td>
                  <td style={{ ...td(), color: C.txt3 }}>{pacificDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function sourceLabel(source: string | null) {
  if (source === 'slack') return 'Slack'
  if (source === 'api') return 'API'
  return 'Web'
}

function Pill({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, color: statusColor(status), background: `${statusColor(status)}1a`,
      padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize',
    }}>{status}</span>
  )
}

const h1 = () => ({ fontFamily: C.serif, fontSize: 28, color: C.txt, margin: 0, fontWeight: 400 as const })
const primaryLink = () => ({
  marginLeft: 'auto', fontSize: 14, fontWeight: 600, fontFamily: C.sans, color: 'oklch(100% 0 0)',
  background: C.earthy, padding: '9px 18px', borderRadius: 9999, textDecoration: 'none',
})
const card = (pad = 24) => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: pad })
const th = () => ({ padding: '12px 18px', fontWeight: 600 as const })
const td = () => ({ padding: '14px 18px', color: C.txt })
