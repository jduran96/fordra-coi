import Link from 'next/link'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import PaginatedTable from '@/components/PaginatedTable'
import { ACTIVE_STATUSES, callRedFlag, dispositionLabel, type AiCall } from '@/lib/ai-calls'

export const dynamic = 'force-dynamic'

interface CallRow extends AiCall {
  verifications: {
    display_id: string | null
    insured_name: string | null
    orgs: { name: string | null } | null
  } | null
}

/** m:ss, or blank for a call that never connected. */
function duration(call: AiCall): string {
  return typeof call.duration_ms === 'number' && call.duration_ms > 0
    ? `${Math.floor(call.duration_ms / 60000)}:${String(Math.floor((call.duration_ms % 60000) / 1000)).padStart(2, '0')}`
    : ''
}

function StatusPill({ call }: { call: AiCall }) {
  const active = ACTIVE_STATUSES.includes(call.status)
  const color = active ? C.warn
    : call.status === 'completed' ? C.ok
    : call.status === 'approved' ? C.neutral
    : C.error
  const label = call.status === 'in_progress' ? 'On the call'
    : call.status === 'dispatched' ? 'Ringing'
    : call.status.charAt(0).toUpperCase() + call.status.slice(1)
  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

/** Global record of AI voice-agent calls across all verifications. */
export default async function AdminCallsPage() {
  await requireAdmin()
  const supabase = createServiceClient()
  const { data, error } = await withRetry(() => supabase
    .from('ai_calls')
    .select('*, verifications(display_id, insured_name, orgs(name))')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(200))
  if (error) throw new Error(`Could not load AI calls: ${error.message}`)
  const calls = (data ?? []) as unknown as CallRow[]

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13.5, color: C.txt, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }

  return (
    <div style={{ fontFamily: C.sans, color: C.txt }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: '0 0 6px', fontWeight: 400 }}>AI calls</h1>
      <p style={{ color: C.txt2, fontSize: 13.5, margin: '0 0 20px' }}>
        Every AI verification call, newest first. Open a verification to see the transcript, recording, and publish state.
      </p>
      {calls.length === 0 ? (
        <p style={{ color: C.txt3, fontSize: 13.5 }}>No AI calls yet. Dispatch one from a verification&apos;s Calls tab.</p>
      ) : (
        <PaginatedTable
          pageSize={15}
          head={
            <tr>
              <th style={th}>When</th>
              <th style={th}>Verification</th>
              <th style={th}>Org</th>
              <th style={th}>Carrier</th>
              <th style={th}>Number</th>
              <th style={th}>Status</th>
              <th style={th}>Length</th>
              <th style={th}>Outcome</th>
              <th style={th}>Log</th>
            </tr>
          }
          rows={calls.map(call => (
            <tr key={call.id}>
              <td style={{ ...td, whiteSpace: 'nowrap', color: C.txt2 }}>{pacificDateTime(call.approved_at ?? call.created_at)}</td>
              <td style={td}>
                <Link href={`/admin/${call.verification_id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'none' }}>
                  {call.verifications?.display_id ?? 'View'}
                </Link>
              </td>
              <td style={{ ...td, color: C.txt2 }}>{call.verifications?.orgs?.name ?? ''}</td>
              <td style={{ ...td, color: C.txt2 }}>{call.verifications?.insured_name ?? ''}</td>
              <td style={{ ...td, fontFamily: C.mono, fontSize: 12.5, whiteSpace: 'nowrap' }}>{call.to_number ?? ''}</td>
              <td style={td}><StatusPill call={call} /></td>
              <td style={{ ...td, fontFamily: C.mono, fontSize: 12.5 }}>{duration(call)}</td>
              <td style={{ ...td, color: C.txt2 }}>
                {dispositionLabel(call)}
                {callRedFlag(call) && <span style={{ color: C.error, fontWeight: 700 }}> · {callRedFlag(call)}</span>}
              </td>
              <td style={{ ...td, color: C.txt3, whiteSpace: 'nowrap' }}>{call.published_note_at ? 'Published' : ''}</td>
            </tr>
          ))}
          cards={calls.map(call => (
            <Link key={call.id} href={`/admin/${call.verification_id}`} style={{
              display: 'block', padding: '13px 14px', borderTop: `1px solid ${C.border}`,
              textDecoration: 'none', color: C.txt,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusPill call={call} />
                <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 12, color: C.txt3 }}>{duration(call)}</span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600, margin: '6px 0 2px' }}>
                {call.verifications?.insured_name || call.verifications?.display_id || 'View'}
              </div>
              <div style={{ fontSize: 12.5, color: C.txt3 }}>
                {call.verifications?.orgs?.name ?? ''} · <span style={{ fontFamily: C.mono }}>{call.to_number ?? ''}</span>
              </div>
              <div style={{ fontSize: 12, color: C.txt3, marginTop: 3 }}>
                {pacificDateTime(call.approved_at ?? call.created_at)}
              </div>
              {(dispositionLabel(call) || call.published_note_at || callRedFlag(call)) && (
                <div style={{ fontSize: 12.5, color: C.txt2, marginTop: 4 }}>
                  {[dispositionLabel(call), call.published_note_at ? 'Published' : ''].filter(Boolean).join(' · ')}
                  {callRedFlag(call) && <span style={{ color: C.error, fontWeight: 700 }}> · {callRedFlag(call)}</span>}
                </div>
              )}
            </Link>
          ))}
        />
      )}
    </div>
  )
}
