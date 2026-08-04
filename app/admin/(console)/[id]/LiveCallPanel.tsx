'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/lib/theme'
import { stopAiCall } from './call/actions'
import TranscriptView from './TranscriptView'
import type { TranscriptEntry } from '@/lib/ai-call-shared'

/**
 * Live view of one in-flight AI call: polls the admin status endpoint every
 * 5s (each poll also persists Retell's latest state), streams the transcript,
 * and carries the kill switch. Polling is the primary mechanism everywhere;
 * the Retell webhook only adds redundancy in production.
 */

interface StatusPayload {
  status: string
  callStatus?: string | null
  transcript: string
  transcriptDetail?: TranscriptEntry[] | null
  disconnectionReason?: string | null
  durationMs?: number | null
  startedAt?: string | null
  error?: string | null
}

const ACTIVE = ['dispatched', 'in_progress']

export default function LiveCallPanel({ verificationId, aiCallId, initial }: {
  verificationId: string
  aiCallId: string
  initial: StatusPayload
}) {
  const router = useRouter()
  const [state, setState] = useState<StatusPayload>(initial)
  const [stopError, setStopError] = useState<string | null>(null)
  const [stopping, startStopping] = useTransition()
  const [now, setNow] = useState(() => Date.now())
  const transcriptRef = useRef<HTMLDivElement>(null)
  const active = ACTIVE.includes(state.status)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/calls/${aiCallId}/status`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as StatusPayload
        if (cancelled) return
        setState(data)
        if (!ACTIVE.includes(data.status)) {
          // Terminal: refresh the server-rendered history cards.
          router.refresh()
        }
      } catch {
        // Transient poll failure: keep the last known state, try again next tick.
      }
    }
    const interval = setInterval(tick, 5000)
    tick()
    return () => { cancelled = true; clearInterval(interval) }
  }, [aiCallId, active, router])

  // Elapsed-time ticker while live.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [state.transcript, state.transcriptDetail])

  const elapsed = (() => {
    if (typeof state.durationMs === 'number' && state.durationMs > 0) return format(state.durationMs)
    if (state.startedAt) return format(now - Date.parse(state.startedAt))
    return null
  })()

  const statusLabel = state.status === 'dispatched' ? 'Ringing'
    : state.status === 'in_progress' ? 'On the call'
    : state.status === 'completed' ? 'Ended'
    : state.status === 'stopped' ? 'Stopped'
    : state.status === 'failed' ? 'Failed'
    : state.status
  const color = active ? C.warn : state.status === 'completed' ? C.ok : C.error

  return (
    <div style={{ border: `1px solid color-mix(in oklch, ${color} 40%, transparent)`, borderRadius: 10, padding: 14, background: C.paper }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>
          {statusLabel}
        </span>
        {active && (
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, animation: 'fordra-spin 1.4s ease-in-out infinite' }} />
        )}
        {elapsed && <span style={{ fontSize: 12.5, color: C.txt3, fontFamily: C.mono }}>{elapsed}</span>}
        {active && (
          <form style={{ marginLeft: 'auto' }} onSubmit={e => {
            e.preventDefault()
            setStopError(null)
            startStopping(async () => {
              const res = await stopAiCall(verificationId, aiCallId)
              if (res && 'error' in res && res.error) setStopError(res.error)
              else router.refresh()
            })
          }}>
            <button type="submit" disabled={stopping} style={{
              padding: '7px 16px', fontSize: 13, fontWeight: 700, fontFamily: C.sans,
              color: C.onDark, background: C.error, border: 'none', borderRadius: 9999,
              cursor: stopping ? 'wait' : 'pointer', opacity: stopping ? 0.7 : 1,
            }}>
              {stopping ? 'Stopping...' : 'Stop call'}
            </button>
          </form>
        )}
      </div>
      {stopError && <p style={{ fontSize: 13, color: C.error, margin: '8px 0 0' }}>{stopError}</p>}
      {state.error && <p style={{ fontSize: 13, color: C.error, margin: '8px 0 0' }}>{state.error}</p>}
      <div ref={transcriptRef} style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', fontSize: 13, color: C.txt2, whiteSpace: 'pre-wrap', lineHeight: 1.6, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>
        <TranscriptView detail={state.transcriptDetail ?? null} flat={state.transcript} emptyText={active ? '' : 'No transcript.'} />
      </div>
    </div>
  )
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
