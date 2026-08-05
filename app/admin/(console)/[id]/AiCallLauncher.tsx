'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import EditorModal from '@/components/EditorModal'
import { ACTIVE_STATUSES, TERMINAL_STATUSES, callRedFlag, dispositionLabel, type AiCall } from '@/lib/ai-call-shared'
import type { AiCallQuestion, CallContextFields, NumberCandidate, ReferenceDetail } from '@/lib/call-config'
import CallReviewForm from './call/CallReviewForm'
import LiveCallPanel from './LiveCallPanel'
import PublishCallButton from './PublishCallButton'
import TranscriptView from './TranscriptView'

/**
 * The AI-calling section: one button that opens the whole call lifecycle in a
 * modal — pre-dial review (exact payload, validation, approve), the live call
 * (status, streaming transcript, kill switch), and the finished call (summary
 * + transcript + add-to-contact-log) — plus the table of prior calls, each
 * viewable in the same modal. Replaces the old /admin/[id]/call page.
 */

interface Props {
  verificationId: string
  context: CallContextFields
  questions: AiCallQuestion[]
  details: ReferenceDetail[]
  numbers: NumberCandidate[]
  coiPhone: string
  draftId: string | null
  caseIsClosed: boolean
  /** Dispatched calls (no drafts), newest first, from the server render. */
  calls: AiCall[]
}

type ModalState = null | { mode: 'new' } | { mode: 'call'; callId: string }

export default function AiCallLauncher({ verificationId, context, questions, details, numbers, coiPhone, draftId, caseIsClosed, calls }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const activeCall = calls.find(c => ACTIVE_STATUSES.includes(c.status)) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!caseIsClosed && (
        <div className="fx-actions" style={{ display: 'flex' }}>
          <button
            type="button"
            onClick={() => setModal(activeCall ? { mode: 'call', callId: activeCall.id } : { mode: 'new' })}
            style={{
              padding: '8px 20px', background: C.earthy, color: C.onDark, fontSize: 13,
              fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer',
            }}>
            {activeCall ? 'View live call' : 'Start AI call'}
          </button>
        </div>
      )}

      {/* An in-flight call always keeps a live panel mounted on the page, not
          just in the modal: the panel's 5s poll is what persists Retell's
          state (the webhook is prod-only redundancy), so with the modal
          closed the row would otherwise stay "in progress" forever, block
          the one-in-flight dispatch guard, and never receive its summary.
          Skipped only while the modal is showing the same call (no double poll). */}
      {activeCall && modal?.mode !== 'call' && (
        <LiveCallPanel
          verificationId={verificationId}
          aiCallId={activeCall.id}
          initial={{
            status: activeCall.status,
            transcript: activeCall.transcript ?? '',
            transcriptDetail: activeCall.transcript_detail,
            durationMs: activeCall.duration_ms,
            startedAt: activeCall.started_at,
            error: activeCall.error,
          }}
        />
      )}

      {calls.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {/* Six columns never fit a phone, so the same rows also render as
              tap-anywhere cards; CSS picks one at 760px. */}
          <table className="fx-only-desktop" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: C.sans }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={th}>When</th><th style={th}>Number</th><th style={th}>Status</th>
                <th style={th}>Duration</th><th style={th}>Outcome</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {calls.map(call => {
                const c = callChrome(call)
                return (
                  <tr key={call.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, color: C.txt3, whiteSpace: 'nowrap' }}>{pacificDateTime(call.approved_at ?? call.created_at)}</td>
                    <td style={{ ...td, fontFamily: C.mono }}>{call.to_number ?? '—'}</td>
                    <td style={td}><StatusPill call={call} /></td>
                    <td style={{ ...td, fontFamily: C.mono, color: C.txt3 }}>{c.duration}</td>
                    <td style={{ ...td, color: C.txt2 }}>
                      {c.outcome}
                      {c.redFlag && <span style={{ color: C.error, fontWeight: 700 }}> · {c.redFlag}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" onClick={() => setModal({ mode: 'call', callId: call.id })}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, fontFamily: C.sans, borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent', color: C.txt2, cursor: 'pointer' }}>
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="fx-only-mobile">
            {calls.map(call => {
              const c = callChrome(call)
              return (
                <button key={call.id} type="button" onClick={() => setModal({ mode: 'call', callId: call.id })}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                    background: 'transparent', border: 'none', borderTop: `1px solid ${C.border}`,
                    fontFamily: C.sans, cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusPill call={call} />
                    <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 12, color: C.txt3 }}>{c.duration}</span>
                  </div>
                  <div style={{ fontFamily: C.mono, fontSize: 13.5, color: C.txt, marginTop: 6 }}>{call.to_number ?? '—'}</div>
                  <div style={{ fontSize: 12, color: C.txt3, marginTop: 2 }}>
                    {pacificDateTime(call.approved_at ?? call.created_at)}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.txt2, marginTop: 4 }}>
                    {c.outcome}
                    {c.redFlag && <span style={{ color: C.error, fontWeight: 700 }}> · {c.redFlag}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {modal?.mode === 'new' && (
        <EditorModal title="Start AI call" onClose={() => setModal(null)} maxWidth={860}>
          <CallReviewForm
            verificationId={verificationId}
            context={context}
            questions={questions}
            details={details}
            numbers={numbers}
            coiPhone={coiPhone}
            draftId={draftId}
            caseIsClosed={caseIsClosed}
            onDispatched={callId => setModal({ mode: 'call', callId })}
          />
        </EditorModal>
      )}

      {modal?.mode === 'call' && (
        <EditorModal title="AI call" onClose={() => setModal(null)} maxWidth={720}>
          <CallView verificationId={verificationId} caseIsClosed={caseIsClosed}
            call={calls.find(c => c.id === modal.callId) ?? null} callId={modal.callId} />
        </EditorModal>
      )}
    </div>
  )
}

/** Row values shared by the desktop table and the phone cards. */
function callChrome(call: AiCall) {
  return {
    duration: typeof call.duration_ms === 'number' && call.duration_ms > 0
      ? `${Math.floor(call.duration_ms / 60000)}:${String(Math.floor((call.duration_ms % 60000) / 1000)).padStart(2, '0')}`
      : '—',
    outcome: call.published_note_at ? 'In contact log' : dispositionLabel(call) || (call.error ? 'Error' : '—'),
    redFlag: callRedFlag(call),
  }
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
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

/**
 * The modal body for one call. While the call is live (or so fresh the server
 * render has not caught up yet) the live panel polls status + transcript and
 * carries the kill switch; the panel's refresh on a terminal status swaps
 * this view to the finished-call layout automatically.
 */
function CallView({ verificationId, caseIsClosed, call, callId }: {
  verificationId: string
  caseIsClosed: boolean
  call: AiCall | null
  callId: string
}) {
  const router = useRouter()
  const terminal = !!call && TERMINAL_STATUSES.includes(call.status)
  const hasAnalysis = !!call?.call_analysis
  // Pre-0038 rows: a flat transcript with no structured detail. Polling the
  // status endpoint makes it backfill transcript_detail from Retell.
  const needsDetail = terminal && !!call?.transcript && !call?.transcript_detail

  // Retell's summary lands up to a minute AFTER the call ends, and the live
  // panel stops polling at the terminal status. The status endpoint syncs
  // analysis (and lazily backfills transcript_detail) for terminal rows when
  // polled (the webhook only covers production), so keep polling while this
  // view waits on either.
  useEffect(() => {
    if (!terminal || (hasAnalysis && !needsDetail)) return
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/calls/${callId}/status`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data.hasAnalysis && (!needsDetail || data.transcriptDetail)) router.refresh()
      } catch {
        // Transient poll failure: try again next tick.
      }
    }, 5000)
    return () => clearInterval(t)
  }, [terminal, hasAnalysis, needsDetail, callId, router])
  if (!terminal) {
    return (
      <LiveCallPanel
        verificationId={verificationId}
        aiCallId={callId}
        initial={{
          status: call?.status ?? 'dispatched',
          transcript: call?.transcript ?? '',
          transcriptDetail: call?.transcript_detail ?? null,
          durationMs: call?.duration_ms,
          startedAt: call?.started_at,
          error: call?.error,
        }}
      />
    )
  }

  const summary = (call.call_analysis?.call_summary ?? '').trim()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: call.status === 'completed' ? C.ok : C.error, background: `color-mix(in oklch, ${call.status === 'completed' ? C.ok : C.error} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>
          {call.status.charAt(0).toUpperCase() + call.status.slice(1)}
        </span>
        {call.to_number && <span style={{ fontFamily: C.mono, fontSize: 13, color: C.txt }}>{call.to_number}</span>}
        <span style={{ fontSize: 13, color: C.txt3 }}>{pacificDateTime(call.approved_at ?? call.created_at)}</span>
        {dispositionLabel(call) && <span style={{ fontSize: 12.5, color: C.txt2 }}>{dispositionLabel(call)}</span>}
        {callRedFlag(call) && (
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.error, background: `color-mix(in oklch, ${C.error} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>
            {callRedFlag(call)}
          </span>
        )}
      </div>
      {call.error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{call.error}</p>}
      {summary ? (
        <div>
          <h3 style={sub}>Summary</h3>
          <p style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{summary}</p>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: C.txt3, margin: 0 }}>The call summary can take a minute to arrive after the call ends.</p>
      )}
      {call.transcript?.trim() && (
        <div>
          <h3 style={sub}>Transcript</h3>
          <div style={{ fontSize: 13, color: C.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.6, overflowWrap: 'anywhere', maxHeight: 300, overflowY: 'auto', paddingLeft: 14, borderLeft: `2px solid ${C.border}` }}>
            <TranscriptView detail={call.transcript_detail} flat={call.transcript.trim()} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {call.recording_url && (
          <a href={call.recording_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: C.txt2 }}>Recording</a>
        )}
        {call.published_note_at ? (
          <span style={{ fontSize: 12.5, color: C.txt3 }}>Added to contact log · {pacificDateTime(call.published_note_at)}</span>
        ) : (!caseIsClosed && (call.transcript || summary) && (
          <PublishCallButton verificationId={verificationId} aiCallId={call.id} />
        ))}
      </div>
    </div>
  )
}

const sub: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }
const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' }
