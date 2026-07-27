import Link from 'next/link'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import PaginatedTable from '@/components/PaginatedTable'
import { ACTIVE_STATUSES, dispositionLabel, type AiCall } from '@/lib/ai-calls'

export const dynamic = 'force-dynamic'

interface CallRow extends AiCall {
  verifications: {
    display_id: string | null
    insured_name: string | null
    orgs: { name: string | null } | null
  } | null
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
          rows={calls.map(call => {
            const active = ACTIVE_STATUSES.includes(call.status)
            const pillColor = active ? C.warn
              : call.status === 'completed' ? C.ok
              : call.status === 'approved' ? C.neutral
              : C.error
            const pillLabel = call.status === 'in_progress' ? 'On the call'
              : call.status === 'dispatched' ? 'Ringing'
              : call.status.charAt(0).toUpperCase() + call.status.slice(1)
            return (
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
                <td style={td}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: pillColor, background: `color-mix(in oklch, ${pillColor} 12%, transparent)`, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    {pillLabel}
                  </span>
                </td>
                <td style={{ ...td, fontFamily: C.mono, fontSize: 12.5 }}>
                  {typeof call.duration_ms === 'number' && call.duration_ms > 0
                    ? `${Math.floor(call.duration_ms / 60000)}:${String(Math.floor((call.duration_ms % 60000) / 1000)).padStart(2, '0')}`
                    : ''}
                </td>
                <td style={{ ...td, color: C.txt2 }}>{dispositionLabel(call)}</td>
                <td style={{ ...td, color: C.txt3, whiteSpace: 'nowrap' }}>{call.published_note_at ? 'Published' : ''}</td>
              </tr>
            )
          })}
        />
      )}
    </div>
  )
}
