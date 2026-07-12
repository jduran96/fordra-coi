import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth-helpers'
import { C, statusColor } from '@/lib/theme'
import { pacificDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function PortalDashboard() {
  const profile = await getProfile()
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('my_verifications')
    .select('id, display_id, carrier_name, status, case_status, source, created_at, published_at')
    .order('created_at', { ascending: false })
  // Fail loudly: rendering "No verifications yet." on a failed read lies.
  if (error) throw new Error(`Could not load verifications: ${error.message}`)

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
        <FirstRunWelcome />
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

/** Shown only while the org has zero verifications; the table replaces it
 *  as soon as the first one lands. */
function FirstRunWelcome() {
  const steps = [
    {
      num: '01',
      title: 'Start a verification',
      body: 'Use the button on the top right to upload a COI and specify your insurance standards.',
      icon: (
        // file-plus
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </>
      ),
    },
    {
      num: '02',
      title: 'Get a report',
      body: 'Within 24 hours, we read what you uploaded, make calls, and share an exportable report.',
      icon: (
        // clipboard-check
        <>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <polyline points="9 13 11.5 15.5 15.5 10.5" />
        </>
      ),
    },
    {
      num: '03',
      title: 'Make your life easier',
      body: 'Use Settings to create repeatable insurance standards and invite your teammates.',
      icon: (
        // sliders
        <>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </>
      ),
    },
  ]

  return (
    <div style={{ ...card(0), padding: '44px 40px 40px' }}>
      <h2 style={{ fontFamily: C.serif, fontSize: 30, fontWeight: 400, color: C.txt, margin: '0 0 10px' }}>
        Welcome to Fordra!
      </h2>
      <p style={{ fontFamily: C.sans, fontSize: 15, color: C.txt2, lineHeight: 1.6, margin: '0 0 32px' }}>
        We automate COI verification by reading docs and calling insurers. Getting started is simple:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {steps.map(s => (
          <div key={s.num} style={{ background: C.cream, borderRadius: 12, padding: '22px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke={C.txt}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {s.icon}
              </svg>
              <span style={{ fontFamily: C.mono, fontSize: 12, color: C.txt3, letterSpacing: '0.5px' }}>{s.num}</span>
            </div>
            <p style={{ fontFamily: C.sans, fontSize: 15, fontWeight: 600, color: C.txt, margin: '0 0 6px' }}>
              Step {Number(s.num)} - {s.title}
            </p>
            <p style={{ fontFamily: C.sans, fontSize: 13.5, color: C.txt2, lineHeight: 1.55, margin: 0 }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>
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
