import Link from 'next/link'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { withRetry } from '@/lib/db'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import PaginatedTable from '@/components/PaginatedTable'
import { ACTIVE_STATUSES, callRedFlag, dispositionLabel, type AiCall } from '@/lib/ai-calls'
import { parseEmailList, stripQuotedReply, threadAwaitingReply, threadStatusLabel, type EmailMessage, type EmailThread } from '@/lib/email-shared'
import { formatTranscriptText } from '@/lib/call-transcript'
import OutreachPeek, { type CallPeekData, type EmailPeekData } from './OutreachPeek'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'calls', label: 'Calls' },
  { key: 'emails', label: 'Emails' },
] as const
type TabKey = (typeof TABS)[number]['key']

interface JoinedVerification {
  display_id: string | null
  insured_name: string | null
  orgs: { name: string | null } | null
}
interface CallRow extends AiCall { verifications: JoinedVerification | null }
interface ThreadRow extends EmailThread { verifications: JoinedVerification | null }

/** The View pop-up's payload for one call: summary + readable transcript. */
function callPeek(call: CallRow): CallPeekData {
  return {
    kind: 'call',
    when: pacificDateTime(call.approved_at ?? call.created_at),
    toNumber: call.to_number ?? '',
    summary: (call.call_analysis?.call_summary ?? '').trim(),
    transcript: call.transcript_detail?.length
      ? formatTranscriptText(call.transcript_detail)
      : (call.transcript ?? '').trim(),
  }
}

/** The View pop-up's payload for one thread: messages newest first, quoted
 *  reply history stripped. */
function emailPeek(thread: ThreadRow, messages: EmailMessage[]): EmailPeekData {
  return {
    kind: 'email',
    when: pacificDateTime(thread.approved_at ?? thread.created_at),
    subject: thread.subject ?? '',
    messages: messages.slice().reverse().map(m => ({
      id: m.id,
      direction: m.direction,
      from: m.direction === 'inbound'
        ? (m.from_name ? `${m.from_name} (${m.from_email ?? ''})` : (m.from_email ?? 'Unknown sender'))
        : `You (${m.from_email ?? ''})`,
      when: m.sent_at ? pacificDateTime(m.sent_at) : '',
      body: stripQuotedReply(m.body_text ?? ''),
      attachments: (m.attachments ?? []).map(a => a.filename).filter(Boolean),
    })),
  }
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

function ThreadStatusPill({ thread }: { thread: EmailThread }) {
  const color = thread.status === 'sent' ? C.ok
    : thread.status === 'failed' ? C.error
    : C.neutral
  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {threadStatusLabel(thread)}
    </span>
  )
}

function ReplyMarker() {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.warn, background: `color-mix(in oklch, ${C.warn} 13%, transparent)`, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      Reply received
    </span>
  )
}

/** Global record of AI outreach — voice calls and email threads — across all
 *  verifications. Sub-tabs use the same URL-driven pattern as /admin/settings. */
export default async function AdminOutreachPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin()
  const rawTab = (await searchParams).tab
  const tab: TabKey = TABS.some(t => t.key === rawTab) ? (rawTab as TabKey) : 'calls'
  const supabase = createServiceClient()

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13.5, color: C.txt, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }

  return (
    <div style={{ fontFamily: C.sans, color: C.txt }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 28, margin: '0 0 6px', fontWeight: 400 }}>AI</h1>
      <p style={{ color: C.txt2, fontSize: 13.5, margin: '0 0 16px' }}>
        Every AI verification call and outreach email, newest first. Open a verification for the full record.
      </p>

      {/* Same segmented control as /admin/settings. */}
      <nav className="fx-scroll-x" style={{ display: 'flex', background: C.paper, borderRadius: 8, padding: 2, border: `1px solid ${C.border}`, marginBottom: 20, width: 'fit-content', maxWidth: '100%' }}>
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/admin/calls?tab=${t.key}`}
            style={{
              fontSize: 12, fontWeight: 600, fontFamily: C.sans, letterSpacing: '0.02em',
              padding: '6px 14px', borderRadius: 6, textDecoration: 'none',
              background: t.key === tab ? C.txt : 'transparent',
              color: t.key === tab ? C.surface : C.txt3, transition: 'all 120ms',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'calls' && <CallsTable th={th} td={td} supabase={supabase} />}
      {tab === 'emails' && <EmailsTable th={th} td={td} supabase={supabase} />}
    </div>
  )
}

async function CallsTable({ th, td, supabase }: {
  th: React.CSSProperties
  td: React.CSSProperties
  supabase: ReturnType<typeof createServiceClient>
}) {
  const { data, error } = await withRetry(() => supabase
    .from('ai_calls')
    .select('*, verifications(display_id, insured_name, orgs(name))')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(200))
  if (error) throw new Error(`Could not load AI calls: ${error.message}`)
  const calls = (data ?? []) as unknown as CallRow[]

  if (calls.length === 0) {
    return <p style={{ color: C.txt3, fontSize: 13.5 }}>No AI calls yet. Dispatch one from a verification&apos;s Calls tab.</p>
  }
  return (
    <PaginatedTable
      pageSize={15}
      head={
        <tr>
          <th style={{ ...th, width: 118 }}>When</th>
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
          <td style={{ ...td, color: C.txt2 }}>{pacificDateTime(call.approved_at ?? call.created_at)}</td>
          <td style={td}>
            <Link href={`/admin/${call.verification_id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>
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
          <td style={{ ...td, whiteSpace: 'nowrap' }}>
            <OutreachPeek data={callPeek(call)} />
          </td>
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
  )
}

async function EmailsTable({ th, td, supabase }: {
  th: React.CSSProperties
  td: React.CSSProperties
  supabase: ReturnType<typeof createServiceClient>
}) {
  const { data, error } = await withRetry(() => supabase
    .from('email_threads')
    .select('*, verifications(display_id, insured_name, orgs(name))')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(200))
  if (error) throw new Error(`Could not load email threads: ${error.message}`)
  const threads = (data ?? []) as unknown as ThreadRow[]

  if (threads.length === 0) {
    return <p style={{ color: C.txt3, fontSize: 13.5 }}>No verification emails yet. Send one from a verification&apos;s Emails tab.</p>
  }

  // Messages for the per-row View pop-up, one query for all listed threads.
  const { data: messageRows } = await supabase
    .from('email_messages')
    .select('*')
    .in('thread_id', threads.map(t => t.id))
    .order('sent_at', { ascending: true })
  const messagesByThread: Record<string, EmailMessage[]> = {}
  for (const m of (messageRows ?? []) as EmailMessage[]) {
    (messagesByThread[m.thread_id] ??= []).push(m)
  }
  return (
    <>
      <p style={{ color: C.txt3, fontSize: 12.5, margin: '0 0 10px' }}>
        Message counts and reply markers update when a thread is refreshed on its verification.
      </p>
      <PaginatedTable
        pageSize={15}
        head={
          <tr>
            <th style={{ ...th, width: 118 }}>When</th>
            <th style={th}>Verification</th>
            <th style={th}>Org</th>
            <th style={th}>To</th>
            <th style={th}>Subject</th>
            <th style={th}>Messages</th>
            <th style={th}>Status</th>
            <th style={th}>Log</th>
          </tr>
        }
        rows={threads.map(t => (
          <tr key={t.id}>
            <td style={{ ...td, color: C.txt2 }}>{pacificDateTime(t.approved_at ?? t.created_at)}</td>
            <td style={td}>
              <Link href={`/admin/${t.verification_id}`} style={{ color: C.txt, fontWeight: 600, textDecoration: 'underline', textDecorationColor: C.limeDeep, textUnderlineOffset: 3 }}>
                {t.verifications?.display_id ?? 'View'}
              </Link>
            </td>
            <td style={{ ...td, color: C.txt2 }}>{t.verifications?.orgs?.name ?? ''}</td>
            <td style={{ ...td, color: C.txt2, whiteSpace: 'nowrap' }}>{parseEmailList(t.to_emails).join(', ')}</td>
            <td style={{ ...td, overflowWrap: 'anywhere' }}>{t.subject ?? ''}</td>
            <td style={{ ...td, fontFamily: C.mono, fontSize: 12.5 }}>{t.message_count || ''}</td>
            <td style={td}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <ThreadStatusPill thread={t} />
                {threadAwaitingReply(t) && <ReplyMarker />}
              </span>
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>
              <OutreachPeek data={emailPeek(t, messagesByThread[t.id] ?? [])} />
            </td>
          </tr>
        ))}
        cards={threads.map(t => (
          <Link key={t.id} href={`/admin/${t.verification_id}`} style={{
            display: 'block', padding: '13px 14px', borderTop: `1px solid ${C.border}`,
            textDecoration: 'none', color: C.txt,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <ThreadStatusPill thread={t} />
              {threadAwaitingReply(t) && <ReplyMarker />}
              <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 12, color: C.txt3 }}>
                {t.message_count > 0 ? `${t.message_count} msg${t.message_count === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 600, margin: '6px 0 2px', overflowWrap: 'anywhere' }}>
              {t.verifications?.insured_name || t.verifications?.display_id || 'View'}
            </div>
            <div style={{ fontSize: 12.5, color: C.txt3, overflowWrap: 'anywhere' }}>
              {t.verifications?.orgs?.name ?? ''} · {parseEmailList(t.to_emails).join(', ')}
            </div>
            <div style={{ fontSize: 12, color: C.txt3, marginTop: 3 }}>
              {pacificDateTime(t.approved_at ?? t.created_at)}
            </div>
            {(t.subject || t.published_note_at) && (
              <div style={{ fontSize: 12.5, color: C.txt2, marginTop: 4, overflowWrap: 'anywhere' }}>
                {[t.subject, t.published_note_at ? 'Published' : ''].filter(Boolean).join(' · ')}
              </div>
            )}
          </Link>
        ))}
      />
    </>
  )
}
